const { getSession } = require('./_auth');

exports.handler = async function(event){
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret){
    return { statusCode: 200, body: JSON.stringify({ authenticated: false }) };
  }
  const session = getSession(event, adminSecret);
  return {
    statusCode: 200,
    body: JSON.stringify({ authenticated: !!session, username: session ? session.u : null })
  };
};
