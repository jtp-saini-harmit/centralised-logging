import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class CentralizedLoggingSolutionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, "MyVPC", {
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // Security Group
    const securityGroup = new ec2.SecurityGroup(this, "MySecurityGroup", {
      vpc,
      allowAllOutbound: true,
    });

    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH access');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP access');


    // Logging
    const logGroup = new logs.LogGroup(this, "MyLogGroup", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // AMI
    const amznLinux = ec2.MachineImage.latestAmazonLinux2();

    // Instance Role and SSM Managed Policy
    const role = new iam.Role(this, "MyEc2Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"));

    role.addToPolicy(new iam.PolicyStatement({
      actions: [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ],
      resources: [logGroup.logGroupArn],
    }));

    
    // const targetAccountRoleArn = 'arn:aws:iam::900820663833:role/FirehoseToS3Stack-FirehoseRoleAA67C190-vMkg67PEs3FY';
    // const firehoseArn = 'arn:aws:firehose:ap-northeast-1:900820663833:deliverystream/FirehoseToS3Stack-MyFirehose-FdjXcicwg4AL';

    // const sourceRole = new iam.Role(this, 'MyCrossAccountRole', {
    //   assumedBy: new iam.ServicePrincipal('logs.amazonaws.com'),
    //   roleName: 'MyCrossAccountRole',
    // });

    // const assumeRolePolicy = new iam.PolicyStatement({
    //   actions: ['sts:AssumeRole'],
    //   resources: [targetAccountRoleArn],
    // });

    // sourceRole.addToPolicy(assumeRolePolicy);

    // const subscriptionFilter = new logs.CfnSubscriptionFilter(this, 'MyLogSubscriptionFilter', {
    //   logGroupName: logGroup.logGroupName,
    //   filterPattern: '',
    //   destinationArn: firehoseArn,
    //   roleArn: sourceRole.roleArn,
    // });

    // Instance
    const instance = new ec2.Instance(this, "MyInstance", {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.NANO),
      machineImage: amznLinux,
      vpc,
      role,
    });

    instance.addUserData(
      "yum install -y amazon-cloudwatch-agent",
      `echo 'Logs will be sent to ${logGroup.logGroupName}'`,
      "/opt/aws/bin/amazon-cloudwatch-agent-ctl -a fetch-config -s"
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
      "yum install -y python3",
      "pip3 install flask",
      "mkdir -p /home/ec2-user/test",
      "cd /home/ec2-user/test",
      "echo \"import logging\" > app.py",
      "echo \"from flask import Flask\" >> app.py",
      "echo \"app = Flask(__name__)\" >> app.py",
      "echo \"logging.basicConfig(filename='myapp.log', level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')\" >> app.py",
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
      "nohup python3 app.py &"
    );
  }
}

