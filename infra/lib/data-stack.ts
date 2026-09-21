import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import type { DeploymentStage } from './environment.js';

export interface DataStackProps extends cdk.StackProps {
  stage: DeploymentStage;
}

/** Datos persistentes aislados. Su despliegue exige revisión explícita de costos. */
export class DataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    cdk.Tags.of(this).add('Application', 'cuentas-pagar');
    cdk.Tags.of(this).add('Environment', props.stage);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    cdk.Tags.of(this).add('CostApprovalRequired', 'true');

    const dataKey = new kms.Key(this, 'DataEncryptionKey', {
      alias: `alias/cuentas-pagar-${props.stage}-data`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      description: `Cifrado de datos persistentes de Cuentas a Pagar (${props.stage}).`,
    });

    const vpc = new ec2.Vpc(this, 'DataVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }],
    });
    // CDK declara opcionales de forma incompatible con exactOptionalPropertyTypes.
    const dataVpc = vpc as unknown as ec2.IVpc;
    // Acceso privado y sin NAT para cargas futuras que suban documentos mediante S3.
    vpc.addGatewayEndpoint('S3GatewayEndpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });

    const documents = new s3.Bucket(this, 'DocumentsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      versioned: true,
      lifecycleRules: [{
        id: 'ArchiveOriginalDocuments',
        enabled: true,
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        transitions: [
          { storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: cdk.Duration.days(30) },
          { storageClass: s3.StorageClass.GLACIER, transitionAfter: cdk.Duration.days(90) },
        ],
      }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: dataVpc,
      allowAllOutbound: false,
      description: 'Accepts PostgreSQL only from RDS Proxy.',
    });
    const proxySecurityGroup = new ec2.SecurityGroup(this, 'ProxySecurityGroup', {
      vpc: dataVpc,
      allowAllOutbound: true,
      description: 'Private RDS Proxy endpoint for application Lambdas.',
    });
    const applicationSecurityGroup = new ec2.SecurityGroup(this, 'ApplicationSecurityGroup', {
      vpc: dataVpc,
      allowAllOutbound: true,
      description: 'Reserved group for application Lambdas that access RDS Proxy.',
    });
    databaseSecurityGroup.addIngressRule(proxySecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL desde RDS Proxy');
    proxySecurityGroup.addIngressRule(applicationSecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL desde Lambdas de aplicación');

    const databaseSecret = new rds.DatabaseSecret(this, 'DatabaseCredentials', {
      username: 'app_owner',
      dbname: 'cuentas_pagar',
      secretName: `cuentas-pagar/${props.stage}/database-credentials`,
      encryptionKey: dataKey,
    });
    const databaseSecretReference = databaseSecret as unknown as secretsmanager.ISecret;
    const parameterGroup = new rds.ParameterGroup(this, 'PostgresParameterGroup', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_6 }),
      parameters: { 'rds.force_ssl': '1' },
    });
    const database = new rds.DatabaseCluster(this, 'AuroraPostgres', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_6 }),
      writer: rds.ClusterInstance.serverlessV2('writer'),
      vpc: dataVpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      credentials: rds.Credentials.fromSecret(databaseSecretReference),
      defaultDatabaseName: 'cuentas_pagar',
      parameterGroup,
      storageEncryptionKey: dataKey,
      backup: { retention: cdk.Duration.days(7) },
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: 30,
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
    });
    const proxy = new rds.DatabaseProxy(this, 'RdsProxy', {
      proxyTarget: rds.ProxyTarget.fromCluster(database),
      secrets: [databaseSecretReference],
      vpc: dataVpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [proxySecurityGroup],
      requireTLS: true,
      maxConnectionsPercent: 80,
      idleClientTimeout: cdk.Duration.minutes(5),
    });

    new cdk.CfnOutput(this, 'DocumentsBucketName', { value: documents.bucketName });
    new cdk.CfnOutput(this, 'DatabaseCredentialsSecretArn', { value: databaseSecret.secretArn });
    new cdk.CfnOutput(this, 'RdsProxyEndpoint', { value: proxy.endpoint });
    new cdk.CfnOutput(this, 'ApplicationSecurityGroupId', { value: applicationSecurityGroup.securityGroupId });
  }
}
