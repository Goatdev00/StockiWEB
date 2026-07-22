// Archivo: /js/pages/auth.js
// Controlador de la página de acceso: tabs Ingresa / Crea tu cuenta,
// validación en cliente y redirección segura tras autenticarse.
import { initLayout } from '../ui/layout.js';
import { showToast } from '../ui/toast.js';
import { signIn, signUp, getUser } from '../api/auth.js';
import { qs, qsa, getQueryParam } from '../utils/dom.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

// Solo se aceptan rutas relativas simples (ej. "cart.html?paso=2") para
// evitar open redirects hacia dominios externos o esquemas peligrosos.
function getSafeNextUrl() {
  const next = (getQueryParam('next') ?? '').trim();
  const isUnsafe =
    !next ||
    next.includes('//') ||
    next.includes('\\') ||
    next.includes(':') ||
    next.startsWith('/') ||
    next.startsWith('.');
  return isUnsafe ? './index.html' : `./${next}`;
}

// Supabase Auth responde en inglés: se traducen los errores más comunes.
function translateAuthError(error) {
  const message = String(error?.message ?? '');
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Correo o contraseña incorrectos';
  if (lower.includes('email not confirmed')) return 'Debes confirmar tu correo antes de ingresar';
  if (lower.includes('already registered')) return 'Ya existe una cuenta con este correo';
  if (lower.includes('at least 6')) return 'La contraseña debe tener al menos 6 caracteres';
  if (lower.includes('rate limit')) return 'Demasiados intentos, espera un momento e inténtalo de nuevo';
  return message || 'Ocurrió un error, inténtalo de nuevo';
}

function setFieldError(errorId, message = '') {
  const element = qs(`#${errorId}`);
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
}

function setBusy(button, busy, busyLabel, idleLabel) {
  button.disabled = busy;
  button.textContent = busy ? busyLabel : idleLabel;
}

function showNotice(message, isSuccess = false) {
  const notice = qs('#auth-notice');
  notice.textContent = message;
  notice.classList.toggle('auth__notice--success', isSuccess);
  notice.hidden = false;
}

function activateTab(mode) {
  const isRegister = mode === 'register';
  const loginTab = qs('#tab-login');
  const registerTab = qs('#tab-register');
  loginTab.classList.toggle('tabs__tab--active', !isRegister);
  loginTab.setAttribute('aria-selected', String(!isRegister));
  registerTab.classList.toggle('tabs__tab--active', isRegister);
  registerTab.setAttribute('aria-selected', String(isRegister));
  qs('#login-form').hidden = isRegister;
  qs('#register-form').hidden = !isRegister;
}

function bindTabs() {
  qs('#tab-login').addEventListener('click', () => activateTab('login'));
  qs('#tab-register').addEventListener('click', () => activateTab('register'));
  qsa('[data-switch]').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.switch));
  });
}

function bindLoginForm() {
  const form = qs('#login-form');
  const submit = qs('#login-submit');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = qs('#login-email').value.trim();
    const password = qs('#login-password').value;

    let valid = true;
    if (!EMAIL_PATTERN.test(email)) {
      setFieldError('login-email-error', 'Ingresa un correo válido');
      valid = false;
    } else {
      setFieldError('login-email-error');
    }
    if (!password) {
      setFieldError('login-password-error', 'Ingresa tu contraseña');
      valid = false;
    } else {
      setFieldError('login-password-error');
    }
    if (!valid) return;

    setBusy(submit, true, 'Ingresando…', 'Ingresar');
    try {
      await signIn({ email, password });
      showToast('¡Hola de nuevo!', 'success');
      window.location.href = getSafeNextUrl();
    } catch (error) {
      console.error(error);
      showToast(translateAuthError(error), 'error');
      setBusy(submit, false, 'Ingresando…', 'Ingresar');
    }
  });
}

function bindRegisterForm() {
  const form = qs('#register-form');
  const submit = qs('#register-submit');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fullName = qs('#register-name').value.trim();
    const email = qs('#register-email').value.trim();
    const password = qs('#register-password').value;

    let valid = true;
    if (fullName.length < 3) {
      setFieldError('register-name-error', 'Ingresa tu nombre completo');
      valid = false;
    } else {
      setFieldError('register-name-error');
    }
    if (!EMAIL_PATTERN.test(email)) {
      setFieldError('register-email-error', 'Ingresa un correo válido');
      valid = false;
    } else {
      setFieldError('register-email-error');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldError('register-password-error', 'La contraseña debe tener al menos 6 caracteres');
      valid = false;
    } else {
      setFieldError('register-password-error');
    }
    if (!valid) return;

    setBusy(submit, true, 'Creando cuenta…', 'Crear cuenta');
    try {
      const data = await signUp({ email, password, fullName });
      if (data.session) {
        showToast('Cuenta creada, ¡bienvenido a Stocki!', 'success');
        window.location.href = getSafeNextUrl();
        return;
      }
      // Sin sesión inmediata: Supabase exige confirmar el correo primero
      form.hidden = true;
      showNotice(`Revisa tu correo para confirmar la cuenta. Te enviamos un enlace a ${email}.`, true);
      setBusy(submit, false, 'Creando cuenta…', 'Crear cuenta');
    } catch (error) {
      console.error(error);
      showToast(translateAuthError(error), 'error');
      setBusy(submit, false, 'Creando cuenta…', 'Crear cuenta');
    }
  });
}

async function init() {
  initLayout();
  try {
    // Con sesión activa esta página no tiene sentido: se vuelve a la portada
    const user = await getUser();
    if (user) {
      window.location.replace('./index.html');
      return;
    }
  } catch {
    // Sin conexión con Auth se muestra el formulario igualmente
  }
  bindTabs();
  bindLoginForm();
  bindRegisterForm();
  if (getQueryParam('mode') === 'register') activateTab('register');
}

init();
