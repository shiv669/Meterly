function createUnauthorizedError(message) {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
}

function authenticateDevelopment(request, _response, next) {
  const authorization = request.get('authorization');

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return next(createUnauthorizedError('Bearer authentication is required'));
  }

  const token = authorization.slice('Bearer '.length).trim();
  const expectedToken = process.env.DEV_AUTH_TOKEN || 'demo-token';

  if (token !== expectedToken) {
    return next(createUnauthorizedError('Invalid development token'));
  }

  request.tenantId = process.env.DEV_TENANT_ID
    || '00000000-0000-4000-8000-000000000001';

  return next();
}

module.exports = { authenticateDevelopment };
