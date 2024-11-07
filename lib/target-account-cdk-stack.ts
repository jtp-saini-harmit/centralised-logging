import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class TargetAccountStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create an S3 bucket in the target account to store logs
    const bucket = new s3.Bucket(this, 'TargetLogsBucket', {
      bucketName: "targetlogsbucket",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      enforceSSL: true,
    });

    // Create IAM role for Firehose to deliver logs to the S3 bucket
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

    // Allow Account 1's CloudWatch Logs to assume this role
    firehoseRole.assumeRolePolicy?.addStatements(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      // principals: [new iam.AccountPrincipal('615299764212')], // Allow Account 1 to assume this role
      conditions: {
        'StringEquals': {
          'sts:ExternalId': '615299764212', // Replace with your external ID
        },
      }
    }));

    bucket.grantReadWrite(firehoseRole);

    // Create the Firehose delivery stream
    new firehose.CfnDeliveryStream(this, 'TargetFirehoseStream', {
      deliveryStreamType: 'DirectPut',
      deliveryStreamName: 'TargetFirehoseStream',
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
    
    // Create Firehose stream (already created above in Account B)
    const firehoseStreamArn = 'arn:aws:firehose:region:034362059217:deliverystream/TargetFirehoseStream';
    
    // Create CloudWatch Logs destination for Firehose
    new logs.CfnSubscriptionFilter(this, 'CloudWatchToFirehoseFilter', {
      logGroupName: '/aws/lambda/my-log-group',
      filterPattern: '',
      destinationArn: firehoseStreamArn,
      roleArn: 'arn:aws:iam::615299764212:role/CloudWatchLogsFirehoseRole', // Role in Account A allowing CloudWatch Logs to push data to Firehose
    });
  }
}
