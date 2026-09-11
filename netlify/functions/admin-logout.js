const { makeExpiredCookie } = require('./_auth');

exports.handler = async function(event){
  return {
    statusCode: 200,
    headers: { 'Set-Cookie': makeExpiredCookie(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true })
  };
};
