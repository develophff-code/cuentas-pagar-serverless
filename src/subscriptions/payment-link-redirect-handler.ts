import type { ApiGatewayRequest, ApiGatewayResponse } from '../api/http-types.js';

export function createPaymentLinkRedirectHandler(resolve: (token: string) => Promise<string | undefined>) {
  return async (request: ApiGatewayRequest): Promise<ApiGatewayResponse> => {
    const token = request.pathParameters?.token;
    const checkoutUrl = token === undefined ? undefined : await resolve(token);
    if (checkoutUrl === undefined) {
      return {
        statusCode: 404,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        body: JSON.stringify({ error: 'PAYMENT_LINK_UNAVAILABLE' }),
      };
    }
    return { statusCode: 302, headers: { location: checkoutUrl, 'cache-control': 'no-store' }, body: '' };
  };
}
