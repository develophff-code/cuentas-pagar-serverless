export interface ApiGatewayRequest {
  httpMethod: string;
  path: string;
  headers?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  requestContext?: {
    authorizer?: {
      claims?: Record<string, string | undefined>;
    };
  };
}

export interface ApiGatewayResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}
