export function handleError({ error, event, status, message }) {
  console.error('[SERVER ERROR]', status, event?.url?.pathname, error);
  return { message: error?.message || message || 'Internal Error' };
}
