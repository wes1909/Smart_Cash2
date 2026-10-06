'use strict';

// Nunca apresenta diretamente ao usuário o texto técnico retornado pelo servidor.
function getAuthErrorMessage(error) {
  const text = typeof error?.message === 'string' ? error.message.toLowerCase() : '';

  if (text.includes('invalid login credentials')) {
    return 'E-mail ou senha incorretos.';
  }
  if (text.includes('email not confirmed')) {
    return 'Confirme seu e-mail antes de entrar.';
  }
  if (text.includes('user already registered')) {
    return 'Já existe uma conta cadastrada com este e-mail.';
  }
  const minimumLength = text.match(/password should be at least (\d+) characters/);
  if (minimumLength) {
    return `A senha deve ter pelo menos ${minimumLength[1]} caracteres.`;
  }
  if (/invalid email|invalid.*email.*(?:address|format)|email.*(?:invalid|not valid)|unable to validate email/.test(text)) {
    return 'Informe um endereço de e-mail válido.';
  }
  if (/failed to fetch|fetch failed|network|connection|load failed|timeout|timed out|err_internet_disconnected/.test(text) ||
      error?.name === 'AuthRetryableFetchError') {
    return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
  }
  return 'Não foi possível concluir a operação. Tente novamente.';
}

// A sessão e os dados financeiros pertencem ao usuário autenticado no Supabase.
document.addEventListener('DOMContentLoaded', () => {
  const auth = document.getElementById('authContainer');
  const app = document.getElementById('appContainer');
  const form = document.getElementById('authForm');
  const email = document.getElementById('authEmail');
  const password = document.getElementById('authPassword');
  const submit = document.getElementById('authSubmit');
  const toggle = document.getElementById('authToggle');
  const status = document.getElementById('authStatus');
  const retry = document.getElementById('authRetry');
  let signup = false;
  let busy = false;
  let revision = 0;
  let activeSession = null;

  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('auth-error', error);
  }

  function setBusy(value) {
    busy = value;
    submit.disabled = toggle.disabled = email.disabled = password.disabled = value;
    form.setAttribute('aria-busy', String(value));
  }

  function hideApp() {
    app.hidden = true;
    auth.hidden = false;
    closeSidebar();
    document.querySelectorAll('.modal.active').forEach(modal => closeModal(modal.id));
    password.value = '';
    document.getElementById('toastContainer').replaceChildren();
  }

  async function applySession(session, version) {
    if (version !== revision) return;
    activeSession = session;
    retry.hidden = true;
    if (!session || !session.user) {
      hideApp();
      resetAppSession();
      form.hidden = false;
      message('Entre com seu e-mail e senha ou crie uma conta.');
      return;
    }
    if (appUserId !== session.user.id) {
      hideApp();
      resetAppSession();
    }
    if (!app.hidden) return; // Renovação de token do mesmo usuário não reinicia.
    form.hidden = true;
    message('Preparando o SmartCash...');
    try {
      await initApp(session);
      if (version !== revision || activeSession?.user?.id !== session.user.id ||
          appUserId !== session.user.id) return;
      password.value = '';
      auth.hidden = true;
      app.hidden = false;
      // Os gráficos foram criados enquanto o contêiner estava oculto.
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    } catch (error) {
      if (version !== revision) return;
      hideApp();
      resetAppSession();
      form.hidden = true;
      message('Não foi possível inicializar o SmartCash. Recarregue a página.', true);
      console.error('[Auth] Inicialização:', error);
    }
  }

  let client;
  try {
    client = supabaseClient;
  } catch (error) {
    message('Não foi possível carregar a autenticação. Verifique sua conexão e recarregue a página.', true);
    return;
  }

  async function checkSession() {
    const version = ++revision;
    retry.hidden = true;
    form.hidden = true;
    message('Verificando sessão...');
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      await applySession(data.session, version);
    } catch (error) {
      if (version !== revision) return;
      hideApp();
      resetAppSession();
      console.error('[Auth] Verificação de sessão:', error);
      message(getAuthErrorMessage(error), true);
      retry.hidden = false;
    }
  }

  client.auth.onAuthStateChange((event, session) => {
    const version = ++revision;
    // Oculta imediatamente na saída; trabalho assíncrono fora do callback Auth.
    if (!session || appUserId !== session.user.id) {
      activeSession = null;
      hideApp();
      resetAppSession();
    }
    setTimeout(() => { void applySession(session, version); }, 0);
  });

  toggle.addEventListener('click', () => {
    signup = !signup;
    document.getElementById('authTitle').textContent = signup ? 'Crie sua conta' : 'Acesse sua conta';
    submit.textContent = signup ? 'Criar conta' : 'Entrar';
    toggle.textContent = signup ? 'Já tenho uma conta' : 'Criar uma conta';
    password.autocomplete = signup ? 'new-password' : 'current-password';
    password.value = '';
    message(signup ? 'Informe seu e-mail e uma senha para se cadastrar.' : 'Entre com seu e-mail e senha.');
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const creating = signup;
    const credentials = { email: email.value.trim(), password: password.value };
    setBusy(true);
    message(creating ? 'Criando conta...' : 'Entrando...');
    try {
      const { data, error } = await (creating
        ? client.auth.signUp(credentials)
        : client.auth.signInWithPassword(credentials));
      if (error) throw error;
      if (data.session && data.session.user) {
        await applySession(data.session, ++revision);
      } else {
        await applySession(null, ++revision);
        message(creating
          ? 'Cadastro recebido. Se necessário, confirme seu e-mail antes de entrar. Nenhuma sessão foi iniciada.'
          : 'Não foi possível iniciar uma sessão. Tente entrar novamente.', !creating);
      }
    } catch (error) {
      console.error('[Auth] Login/cadastro:', error);
      message(getAuthErrorMessage(error), true);
    } finally {
      password.value = '';
      setBusy(false);
    }
  });

  // Delegação no contêiner: seu conteúdo é recriado a cada encerramento de sessão.
  app.addEventListener('click', async event => {
    const logout = event.target.closest('#btnLogout');
    if (!logout) return;
    if (logout.disabled) return;
    logout.disabled = true;
    ++revision;
    activeSession = null;
    hideApp();
    resetAppSession();
    form.hidden = true;
    message('Encerrando sessão...');
    try {
      // Encerra a sessão deste navegador; outras sessões permanecem independentes.
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      await applySession(null, ++revision);
      email.value = '';
      email.focus();
    } catch (error) {
      console.error('[Auth] Logout:', error);
      // Se a saída falhar, reconstrói a interface a partir da sessão real.
      await checkSession();
      message(getAuthErrorMessage(error), true);
    } finally {
      logout.disabled = false;
    }
  });

  retry.addEventListener('click', () => { void checkSession(); });
  // Atualiza também instalações existentes antes do primeiro login.
  registerServiceWorker();
  void checkSession();
});
