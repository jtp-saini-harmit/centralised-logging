import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3notifications from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';

export class FirehoseAndVPCStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Create an S3 bucket for Firehose
        const bucket = new s3.Bucket(this, 'CloudWatchLogsBucket', {
            removalPolicy: cdk.RemovalPolicy.DESTROY, enforceSSL: true
        });

        const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });

        // Create the Lambda function to rename log files
        const renameLambda = new lambda.Function(this, 'RenameLogFilesFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('lib/lambda'), // Path to the directory containing index.js
            timeout: cdk.Duration.seconds(60),
            role: lambdaRole,
        });

        lambdaRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
            ],
            resources: [
                `${bucket.bucketArn}/*`, // Allow actions on all objects in the bucket
            ],
        }));
        
        bucket.grantReadWrite(renameLambda);
        
        // Add S3 notification to trigger Lambda function on object creation
        bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3notifications.LambdaDestination(renameLambda));
        
        // Create IAM role for Firehose
        const firehoseRole = new iam.Role(this, 'FirehoseRole', {
            assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
        });

        firehoseRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
            ],
            resources: [
                `${bucket.bucketArn}/*`, // Allow actions on all objects in the bucket
            ],
        }));

        bucket.grantReadWrite(firehoseRole);

        // Create the Firehose delivery stream
        const firehoseStream = new firehose.CfnDeliveryStream(this, 'MyDeliveryStream', {

            extendedS3DestinationConfiguration: {
                bucketArn: bucket.bucketArn,
                roleArn: firehoseRole.roleArn,
                bufferingHints: {
                    intervalInSeconds: 300,
                    sizeInMBs: 5,
                },
                compressionFormat: 'GZIP',
            },
        });

        // Create IAM role for CloudWatch Logs
        const cwlRole = new iam.Role(this, 'CWLtoFirehoseRole', {
            assumedBy: new iam.ServicePrincipal('logs.amazonaws.com'),
            inlinePolicies: {
                CWLPolicy: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            actions: ['firehose:*'],
                            resources: ['*'],
                        }),
                    ],
                }),
            },
        });

        // Create a log group and add a subscription filter
        const logGroup = new logs.LogGroup(this, 'CloudTrailLogGroup', {
            logGroupName: 'CloudTrail',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        new logs.CfnSubscriptionFilter(this, 'LogGroupSubscription', {
            logGroupName: logGroup.logGroupName,
            filterPattern: '',
            destinationArn: firehoseStream.attrArn,
            roleArn: cwlRole.roleArn,
        });

        // Grant Lambda additional permissions
        lambdaRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
            ],
            resources: [`${bucket.bucketArn}/*`], // Allow actions on all objects in the bucket
        }));

        // VPC
        const vpc = new ec2.Vpc(this, 'MyVPC', {
            natGateways: 0,
            subnetConfiguration: [{
                name: 'public',
                subnetType: ec2.SubnetType.PUBLIC,
            }],
        });

        // Security Group
        const securityGroup = new ec2.SecurityGroup(this, 'MySecurityGroup', {
            vpc,
            allowAllOutbound: true,
        });

        securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH access');
        securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP access');

        // Instance Role and SSM Managed Policy
        const instanceRole = new iam.Role(this, 'MyEc2Role', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        });

        instanceRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
        instanceRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'));

        instanceRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
            ],
            resources: [logGroup.logGroupArn],
        }));

        instanceRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                's3:ListBucket',
                's3:GetObject',
            ],
            resources: [
                bucket.bucketArn,
                `${bucket.bucketArn}/*`,
            ],
        }));

        // Instance
        const instance = new ec2.Instance(this, 'MyInstance', {
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.NANO),
            machineImage: ec2.MachineImage.latestAmazonLinux2(),
            vpc,
            role: instanceRole,
            securityGroup,
        });

        instance.addUserData(
            "sudo yum install -y amazon-cloudwatch-agent",
            `echo 'Logs will be sent to ${logGroup.logGroupName}'`,
            "sudo /opt/aws/bin/amazon-cloudwatch-agent-ctl -a fetch-config -s"
          );
      
          instance.addUserData(
            "cat << 'EOF' > /opt/aws/amazon-cloudwatch-agent/bin/config.json",
            "{",
            "  \"logs\": {",
            "    \"logs_collected\": {",
            "      \"files\": {",
            "        \"collect_list\": [",
            "          {",
            "            \"file_path\": \"/var/log/myapp.log\",",
            `            "log_group_name": "${logGroup.logGroupName}",`,
            "            \"log_stream_name\": \"{instance_id}\"",
            "          }",
            "        ]",
            "      }",
            "    }",
            "  }",
            "}",
            "EOF",
            "sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -s -c file:/opt/aws/amazon-cloudwatch-agent/bin/config.json",
          );
      
          // User data to set up Flask app
          instance.addUserData(
            "sudo yum install -y python3",
            "sudo pip3 install flask",
            "sudo mkdir -p /home/ec2-user/test",
            "cd /home/ec2-user/test",
            "echo \"import logging\" > app.py",
            "echo \"from flask import Flask\" >> app.py",
            "echo \"app = Flask(__name__)\" >> app.py",
            "echo \"logging.basicConfig(filename='/var/log/myapp.log', level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')\" >> app.py",
            "echo \"@app.route('/')\" >> app.py",
            "echo \"def hello():\" >> app.py",
            "echo \"    app.logger.info('Hello endpoint was reached')\" >> app.py",
            "echo \"    return 'Hello, This is source account!'\" >> app.py",
            "echo \"@app.route('/error')\" >> app.py",
            "echo \"def error():\" >> app.py",
            "echo \"    app.logger.error('An error occurred!')\" >> app.py",
            "echo \"    return 'This is an error route!', 500\" >> app.py",
            "echo \"if __name__ == '__main__':\" >> app.py",
            "echo \"    app.run(host='0.0.0.0', port=80, debug=True)\" >> app.py",
            "sudo nohup python3 app.py &"
          );
    }
}
