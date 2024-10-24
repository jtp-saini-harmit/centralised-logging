import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class FirehoseAndVPCStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Create an S3 bucket for Firehose
        const bucket = new s3.Bucket(this, 'CloudWatchLogsBucket', {
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN in production
        });

        // Create IAM role for Firehose
        const firehoseRole = new iam.Role(this, 'FirehoseRole', {
            assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
        });

        bucket.grantReadWrite(firehoseRole);

        // Create the Firehose delivery stream
        const firehoseStream = new firehose.CfnDeliveryStream(this, 'MyDeliveryStream', {
            s3DestinationConfiguration: {
                bucketArn: bucket.bucketArn,
                roleArn: firehoseRole.roleArn,
                bufferingHints: {
                    intervalInSeconds: 300,
                    sizeInMBs: 5,
                },
                compressionFormat: 'UNCOMPRESSED', // Logs are already compressed
            },
        });

        // Create IAM role for CloudWatch Logs
        const cwlRole = new iam.Role(this, 'CWLtoFirehoseRole', {
            assumedBy: new iam.ServicePrincipal('logs.amazonaws.com'),
            inlinePolicies: {
                CWLPolicy: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            actions: ['firehose:PutRecord'],
                            resources: [firehoseStream.attrArn],
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
            filterName: 'Destination',
            filterPattern: '{$.userIdentity.type = Root}',
            destinationArn: firehoseStream.attrArn,
            roleArn: cwlRole.roleArn,
        });

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

        // Create a role for VPC Flow Logs
        const flowLogRole = new iam.Role(this, 'FlowLogRole', {
            assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
        });

        // Grant CloudWatch Logs permissions to the Flow Log role
        flowLogRole.addToPolicy(new iam.PolicyStatement({
            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [logGroup.logGroupArn],
        }));

        // Create VPC Flow Logs
        new ec2.CfnFlowLog(this, 'MyVpcFlowLog', {
            resourceId: vpc.vpcId,
            resourceType: 'VPC',
            trafficType: 'ALL',
            logGroupName: logGroup.logGroupName,
            deliverLogsPermissionArn: flowLogRole.roleArn,
        });

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

        // Instance
        const instance = new ec2.Instance(this, 'MyInstance', {
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.NANO),
            machineImage: ec2.MachineImage.latestAmazonLinux2(),
            vpc,
            role: instanceRole,
            securityGroup,
        });

        instance.addUserData(
            'yum install -y amazon-cloudwatch-agent',
            `echo 'Logs will be sent to ${logGroup.logGroupName}'`,
            '/opt/aws/bin/amazon-cloudwatch-agent-ctl -a fetch-config -s'
        );

        // User data to set up a simple logging application
        instance.addUserData(
            "sudo yum update -y",
            "sudo yum install -y httpd",
            "sudo systemctl start httpd",
            "sudo systemctl enable httpd",
            "mkdir -p /var/www/html",
            "cd /var/www/html",
            "echo \"<h1>Hello World!</h1>\" > index.html",
            "sudo systemctl restart httpd"
        );
    }
}
