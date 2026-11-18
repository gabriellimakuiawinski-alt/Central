// Retorno do login do Google: guarda o token só nesta aba (sessionStorage) e volta para Ajustes.
// O token fica fora da URL do app para não se misturar com as rotas nem com a sessão do Supabase.
(function () {
  const p = new URLSearchParams(location.hash.slice(1));
  const back = new URL('./', location.href).toString() + '#/config';
  history.replaceState(null, '', location.pathname);
  const state = sessionStorage.getItem('central.drive.state');
  sessionStorage.removeItem('central.drive.state');
  if (p.get('access_token') && state && p.get('state') === state) {
    sessionStorage.setItem('central.drive.token', JSON.stringify({ token: p.get('access_token'), exp: Date.now() + Number(p.get('expires_in') || 3600) * 1000 }));
  } else {
    sessionStorage.removeItem('central.drive.pending');
    sessionStorage.setItem('central.drive.error', p.get('error') || 'retorno inválido');
  }
  location.replace(back);
})();
