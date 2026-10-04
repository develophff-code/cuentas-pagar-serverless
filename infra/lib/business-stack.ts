import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'node:path';
import type { DeploymentStage } from './environment.js';
import type { DataStack } from './data-stack.js';
import type { MvpDataStack } from './mvp-data-stack.js';
import { parseTemplateBindings } from '../../src/notifications/subscription-template.js';

export interface BusinessStackProps extends cdk.StackProps {
  stage: DeploymentStage;
  data: DataStack | MvpDataStack;
  runtimeConfig: secretsmanager.ISecret;
  runtimeConfigEncryptionKeyArn: string;
  templateBindings?: string;
  enableSchedules?: boolean;
  publicDomain?: string;
}

/** Opt-in: preparar por synth; desplegar sólo tras aprobación de costos. */
export class BusinessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BusinessStackProps) {
    super(scope, id, props);
    cdk.Tags.of(this).add('Application', 'cuentas-pagar');
    cdk.Tags.of(this).add('Environment', props.stage);
    cdk.Tags.of(this).add('CostApprovalRequired', 'true');
    if (props.enableSchedules && (!props.templateBindings || !props.publicDomain)) {
      throw new Error('Schedules require confirmed templates and public domain.');
    }
    if (props.templateBindings) parseTemplateBindings(props.templateBindings);
    const data = props.data;
    const mvp = data.connectionMode === 'data-api';
    const dispatchDlq = mvp ? new sqs.Queue(this, 'DispatchDlq', {
      encryption: sqs.QueueEncryption.SQS_MANAGED, retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    }) : undefined;
    const dispatchQueue = dispatchDlq ? new sqs.Queue(this, 'DispatchQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED, visibilityTimeout: cdk.Duration.minutes(18),
      deadLetterQueue: { queue: dispatchDlq, maxReceiveCount: 5 },
    }) : undefined;
    const api = new apigateway.RestApi(this, 'BusinessApi', {
      endpointConfiguration: { types: [apigateway.EndpointType.REGIONAL] },
      deployOptions: { stageName: props.stage },
    });
    const apiHost = `${api.restApiId}.execute-api.${this.region}.${this.urlSuffix}`;
    const apiBase = `https://${apiHost}/${props.stage}`;
    const pool = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false, signInAliases: { email: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    pool.addClient('WebClient', { generateSecret: false, authFlows: { userSrp: true } });
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'BusinessAuthorizer', { cognitoUserPools: [pool] });
    const code = lambda.Code.fromAsset(path.resolve(process.cwd(), '.lambda-build'));
    const createFunction = (name: string, handler: string, runtimeSecret: boolean, timeout = 30) => {
      const group = new logs.LogGroup(this, `${name}Logs`, {
        retention: mvp ? logs.RetentionDays.ONE_WEEK : logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.RETAIN,
      });
      const fn = new lambda.Function(this, name, {
        runtime: lambda.Runtime.NODEJS_22_X, handler, code, memorySize: 512,
        timeout: cdk.Duration.seconds(timeout),
        ...(data.connectionMode === 'proxy' ? {
          vpc: data.vpc, vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          securityGroups: [data.applicationSecurityGroup],
        } : {}),
        ...(mvp ? { reservedConcurrentExecutions: 2 } : {}),
        logGroup: group as unknown as logs.ILogGroupRef,
        environment: {
          ...(data.connectionMode === 'data-api' ? {
            DATABASE_ACCESS_MODE: 'data-api', DATABASE_CLUSTER_ARN: data.clusterArn,
          } : { DATABASE_ACCESS_MODE: 'proxy', DATABASE_HOST: data.proxyEndpoint, NODE_EXTRA_CA_CERTS: '/var/runtime/ca-cert.pem' }),
          DATABASE_NAME: 'cuentas_pagar',
          DATABASE_CREDENTIALS_SECRET_ARN: props.data.databaseSecret.secretArn,
          ...(runtimeSecret ? { RUNTIME_CONFIG_SECRET_ARN: props.runtimeConfig.secretArn } : {}),
          PUBLIC_APP_BASE_URL: props.publicDomain ? `https://${props.publicDomain}` : apiBase,
          MERCADO_PAGO_WEBHOOK_URL: `${apiBase}/api/webhook/mercado-pago`,
        },
      });
      // Sólo políticas IAM en esta stack: grantRead también modifica la política
      // KMS de la stack de datos y genera una dependencia circular entre stacks.
      fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({ actions: ['secretsmanager:GetSecretValue'],
        resources: [props.data.databaseSecret.secretArn, ...(runtimeSecret ? [props.runtimeConfig.secretArn] : [])] }));
      const decryptKeys = [...(data.connectionMode === 'proxy' ? [data.databaseEncryptionKeyArn] : []),
        ...(runtimeSecret ? [props.runtimeConfigEncryptionKeyArn] : [])];
      if (decryptKeys.length) fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({ actions: ['kms:Decrypt'], resources: decryptKeys }));
      if (data.connectionMode === 'data-api') fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
        actions: ['rds-data:ExecuteStatement', 'rds-data:BeginTransaction', 'rds-data:CommitTransaction', 'rds-data:RollbackTransaction'],
        resources: [data.clusterArn],
      }));
      fn.metricErrors({ period: cdk.Duration.minutes(5) }).createAlarm(this, `${name}Errors`, {
        threshold: 1, evaluationPeriods: 1, treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      return fn;
    };
    const business = createFunction('BusinessHandler', 'src/api/lambda.handler', true);
    const redirect = createFunction('PaymentRedirect', 'src/subscriptions/payment-link-lambda.handler', false);
    const mercadoPago = createFunction('MercadoPagoWebhook', 'src/webhooks/mercado-pago-lambda.handler', true);
    const lifecycle = createFunction('SubscriptionLifecycle', 'src/jobs/subscription-lifecycle-job.handler', true, 180);
    const dispatcher = createFunction('NotificationDispatcher', 'src/jobs/notification-dispatch-job.handler', true, 180);
    if (props.templateBindings) dispatcher.addEnvironment('YCLOUD_SUBSCRIPTION_TEMPLATE_BINDINGS', props.templateBindings);
    const authenticated = { authorizationType: apigateway.AuthorizationType.COGNITO, authorizer };
    const v1 = api.root.addResource('v1');
    v1.addMethod('ANY', new apigateway.LambdaIntegration(business), authenticated);
    v1.addProxy({ defaultIntegration: new apigateway.LambdaIntegration(business), defaultMethodOptions: authenticated });
    api.root.addResource('p').addResource('{token}').addMethod('GET', new apigateway.LambdaIntegration(redirect));
    api.root.addResource('subscription').addResource('payment').addResource('{result}')
      .addMethod('GET', new apigateway.LambdaIntegration(redirect));
    api.root.addResource('api').addResource('webhook').addResource('mercado-pago')
      .addMethod('POST', new apigateway.LambdaIntegration(mercadoPago));
    new events.Rule(this, 'LifecycleDaily', {
      schedule: events.Schedule.cron({ hour: '12', minute: '0' }), enabled: props.enableSchedules ?? false,
      targets: [new targets.LambdaFunction(lifecycle, { retryAttempts: 2 })],
    });
    if (dispatchQueue) {
      dispatchQueue.grantConsumeMessages(dispatcher);
      new lambda.EventSourceMapping(this, 'DispatchMessages', { target: dispatcher,
        eventSourceArn: dispatchQueue.queueArn, batchSize: 1, enabled: props.enableSchedules ?? false });
      for (const fn of [lifecycle, mercadoPago, dispatcher]) {
        fn.addEnvironment('NOTIFICATION_DISPATCH_QUEUE_URL', dispatchQueue.queueUrl);
        dispatchQueue.grantSendMessages(fn);
      }
      dispatchDlq!.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(5) }).createAlarm(this, 'DispatchDlqMessages', {
        threshold: 1, evaluationPeriods: 1, treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    } else new events.Rule(this, 'NotificationEveryMinute', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)), enabled: props.enableSchedules ?? false,
      targets: [new targets.LambdaFunction(dispatcher, { retryAttempts: 2 })],
    });
    if (props.publicDomain) {
      // ACM DNS validation awaits manual CNAME at Hostinger; no DNS mutations.
      const certificate = new acm.Certificate(this, 'PublicCertificate', {
        domainName: props.publicDomain, validation: acm.CertificateValidation.fromDns(),
      });
      const distribution = new cloudfront.Distribution(this, 'PublicDistribution', {
        domainNames: [props.publicDomain], certificate,
        defaultBehavior: {
          origin: new origins.HttpOrigin(apiHost, { originPath: `/${props.stage}` }),
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
        errorResponses: [404, 500, 503].map((httpStatus) => ({ httpStatus, ttl: cdk.Duration.seconds(0) })),
      });
      new cdk.CfnOutput(this, 'PublicDomainCnameTarget', { value: distribution.distributionDomainName });
    }
    new cdk.CfnOutput(this, 'BusinessApiBaseUrl', { value: apiBase });
    new cdk.CfnOutput(this, 'MercadoPagoWebhookUrl', { value: `${apiBase}/api/webhook/mercado-pago` });
    new cdk.CfnOutput(this, 'CognitoUserPoolId', { value: pool.userPoolId });
  }
}
