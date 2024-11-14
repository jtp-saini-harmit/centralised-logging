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
    const bucket = new s3.Bucket(this, 'TargetLogBucket', {
      bucketName: "targetlogsbucket",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      enforceSSL: true,
    });

    const firehoseTrustPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          principals: [new iam.ServicePrincipal('firehose.amazonaws.com')],
          conditions: {
            StringEquals: {
              'sts:ExternalId': '034362059217', 
            },
          },
        }),
      ],
    });

    const firehoseRole = new iam.Role(this, 'FirehosetoS3Role', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      inlinePolicies: {
        PermissionsForFirehose: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                's3:AbortMultipartUpload',
                's3:GetBucketLocation',
                's3:GetObject',
                's3:ListBucket',
                's3:ListBucketMultipartUploads',
                's3:PutObject',
              ],
              resources: [
                bucket.bucketArn,
                `${bucket.bucketArn}/*`, // All objects in the bucket
              ],
            }),
          ],
        }),
      },
    });

    // const firehoseStream = new firehose.CfnDeliveryStream(this, 'MyDeliveryStream', {
    //   deliveryStreamType: 'DirectPut',
    //   s3DestinationConfiguration: {
    //     roleArn: firehoseRole.roleArn,
    //     bucketArn: bucket.bucketArn,
    //     bufferingHints: {
    //       intervalInSeconds: 300,
    //       sizeInMBs: 5,
    //     },
    //     compressionFormat: 'GZIP',
    //     cloudWatchLoggingOptions: {
    //       enabled: false,
    //     },
    //     prefix: 'defaultTopic=!{partitionKeyFromQuery:defaultTopic}/!{timestamp:yyyy/MM/dd}/',
    //     errorOutputPrefix: 'error/!{firehose:error-output-type}/',
    //     dynamicPartitioningConfiguration: {
    //         enabled: true,
    //     },
    //     processingConfiguration: {
    //         enabled: true,
    //         processors: [
    //             {
    //                 type: 'MetadataExtraction',
    //                 parameters: [
    //                 {
    //                     parameterName: 'MetadataExtractionQuery',
    //                     parameterValue: '{defaultTopic: .data.defaultTopic}',
    //                 },
    //                 {
    //                     parameterName: 'JsonParsingEngine',
    //                     parameterValue: 'JQ-1.6',
    //                 },
    //                 ],
    //           },
    //           {
    //             type: 'AppendDelimiterToRecord',
    //             parameters: [
    //               {
    //                 parameterName: 'Delimiter',
    //                 parameterValue: '\\n',
    //               },
    //             ],
    //           },
    //         ]
    //     }
    //   }
    // });

    const firehoseStream = new firehose.CfnDeliveryStream(this, 'MyDeliveryStream', {
        deliveryStreamType: 'DirectPut',
        extendedS3DestinationConfiguration: {
          roleArn: firehoseRole.roleArn,
          bucketArn: bucket.bucketArn,
          bufferingHints: {
            intervalInSeconds: 300,
            sizeInMBs: 64,
          },
          compressionFormat: 'GZIP',
          cloudWatchLoggingOptions: {
            enabled: false,
          },
          prefix: 'logGroup=!{partitionKeyFromQuery:logGroup}/!{timestamp:yyyy/MM/dd}/',
          errorOutputPrefix: 'error/!{firehose:error-output-type}/',
          dynamicPartitioningConfiguration: {
            enabled: true,
          },
          processingConfiguration: {
            enabled: true,
            processors: [
              {
                type: 'MetadataExtraction',
                parameters: [
                  {
                    parameterName: 'MetadataExtractionQuery',
                    parameterValue: '{logGroup: .data.logGroup}',
                  },
                  {
                    parameterName: 'JsonParsingEngine',
                    parameterValue: 'JQ-1.6',
                  },
                ],
              },
              {
                type: 'AppendDelimiterToRecord',
                parameters: [
                  {
                    parameterName: 'Delimiter',
                    parameterValue: '\\n',
                  },
                ],
              },
            ],
          },
        },
      });

    const cloudWatchLogsTrustPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          principals: [new iam.ServicePrincipal('logs.ap-northeast-1.amazonaws.com')],
          conditions: {
            StringLike: {
              'aws:SourceArn': [
                `arn:aws:logs:ap-northeast-1:034362059217:*`,
                `arn:aws:logs:ap-northeast-1:615299764212:*`,
              ],
            },
          },
        }),
      ],
    });

    const cloudWatchLogsRole = new iam.Role(this, 'CWLtoFirehoseRole', {
      assumedBy: new iam.ServicePrincipal('logs.amazonaws.com'),
      inlinePolicies: {
        PermissionsForCWL: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['firehose:ListDeliveryStreams'],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              actions: [
                'firehose:DescribeDeliveryStream',
                'firehose:PutRecord',
                'firehose:PutRecordBatch',
              ],
              resources: [firehoseStream.attrArn],
            }),
          ],
        }),
      },
    });

    const logDestination = new logs.CfnDestination(this, 'CloudWatchLogsDestination', {
      destinationName: 'MyDestination',
      targetArn: firehoseStream.attrArn,
      roleArn: cloudWatchLogsRole.roleArn,
      destinationPolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              AWS: '615299764212', // Replace with the AWS account ID allowed to send logs
            },
            Action: 'logs:PutSubscriptionFilter',
            Resource: `arn:aws:logs:ap-northeast-1:034362059217:destination:MyDestination`,
          },
        ],
      })
    });    
  }
}
 