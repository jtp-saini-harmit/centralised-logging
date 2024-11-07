import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';

export class SourceAccountStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Target Account Firehose ARN (Replace with the actual ARN of the Firehose in the target account)
        const firehoseStreamArn = 'arn:aws:firehose:ap-northeast-1:034362059217:deliverystream/TargetFirehoseStream';
        const firehoseRoleArn = 'arn:aws:iam::034362059217:role/CloudWatchCrossAccountRole'; // From Account B


        // CloudWatch Logs subscription to trigger the Lambda function on new log events
        new logs.CfnSubscriptionFilter(this, 'MyLogGroupSubscription', {
          logGroupName: logGroup.logGroupName,
          filterPattern: '',
          destinationArn: firehoseStreamArn,
          // roleArn: logForwardingLambda.role?.roleArn || '',  // Role to allow CloudWatch to invoke Lambda
        });

        const cloudWatchToFirehoseRole = new iam.Role(this, 'CloudWatchToFirehoseRole', {
          assumedBy: new iam.ServicePrincipal('logs.amazonaws.com'),
          inlinePolicies: {
            CrossAccountFirehosePolicy: new iam.PolicyDocument({
              statements: [
                new iam.PolicyStatement({
                  actions: ['sts:AssumeRole'],
                  resources: ['arn:aws:iam::Account-B-ID:role/FirehoseWriteRole'], // Role in Account B
                }),
              ],
            }),
          },
        });

        // VPC Setup for EC2 instance
        const vpc = new ec2.Vpc(this, 'Vpc', {
            maxAzs: 2,
            subnetConfiguration: [{
                name: 'PublicSubnet',
                subnetType: ec2.SubnetType.PUBLIC,
            }],
        });

        // Security Group for EC2 instance
        const securityGroup = new ec2.SecurityGroup(this, 'MySecurityGroup', {
            vpc,
            allowAllOutbound: true,
        });
        securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH access');
        securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP access');

        // IAM Role for EC2 Instance
        const instanceRole = new iam.Role(this, 'MyEC2Role', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        });

        instanceRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
        instanceRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'));

        instanceRole.addToPolicy(new iam.PolicyStatement({
            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [logGroup.logGroupArn],
        }));

        // EC2 instance setup
        const instance = new ec2.Instance(this, 'FlaskAppInstance', {
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.NANO),
            machineImage: ec2.MachineImage.latestAmazonLinux2(),
            vpc,
            role: instanceRole,
            securityGroup,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC,
            },
        });

        // EC2 instance user data to set up CloudWatch Agent and Flask app
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
            "sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -s -c file:/opt/aws/amazon-cloudwatch-agent/bin/config.json"
        );

        // Flask app setup in EC2 instance
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
