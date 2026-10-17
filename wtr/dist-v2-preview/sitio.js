// Interacciones del sitio de WTR: menú móvil, aparición al scrollear, preguntas
// del hero, barra de agenda en celular y formulario.
(function () {
  var sinMovimiento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Preguntas del hero: rotan cada 5 s; se frenan con el mouse o el foco encima.
  // Con movimiento reducido no rotan: el CSS las muestra todas.
  var caja = document.getElementById('preguntas');
  if (caja && !sinMovimiento) {
    var items = caja.querySelectorAll('li');
    var num = document.getElementById('preguntaNum');
    var actual = 0, pausa = false;
    caja.addEventListener('mouseenter', function () { pausa = true; });
    caja.addEventListener('mouseleave', function () { pausa = false; });
    caja.addEventListener('focusin', function () { pausa = true; });
    caja.addEventListener('focusout', function () { pausa = false; });
    setInterval(function () {
      if (pausa || document.hidden) return;
      items[actual].classList.remove('activa');
      actual = (actual + 1) % items.length;
      items[actual].classList.add('activa');
      num.textContent = (actual < 9 ? '0' : '') + (actual + 1);
    }, 5000);
  }

  // Barra "Agendá una charla" (el CSS la muestra solo en celular): aparece al
  // bajar y se esconde cuando la sección de contacto está a la vista.
  var barra = document.getElementById('barraAgenda');
  var contacto = document.getElementById('contacto');
  var contactoVisible = false;
  function actualizarBarra() {
    if (barra) barra.classList.toggle('visible', window.scrollY > 480 && !contactoVisible);
  }
  if (barra) {
    if (contacto && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { contactoVisible = en[0].isIntersecting; actualizarBarra(); }).observe(contacto);
    }
    window.addEventListener('scroll', actualizarBarra, { passive: true });
  }

  var btn = document.getElementById('menuBtn');
  var nav = document.getElementById('nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var abierto = nav.classList.toggle('abierto');
      btn.setAttribute('aria-expanded', abierto ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) { nav.classList.remove('abierto'); btn.setAttribute('aria-expanded', 'false'); }
    });
  }

  var elementos = document.querySelectorAll('.revelar');
  if ('IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('visible'); obs.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    elementos.forEach(function (el) { obs.observe(el); });
  } else {
    elementos.forEach(function (el) { el.classList.add('visible'); });
  }

  var form = document.getElementById('formContacto');
  if (!form) return;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var error = document.getElementById('formError');
    var ok = document.getElementById('formOk');
    var datos = {
      nombre: form.nombre.value.trim(),
      email: form.email.value.trim(),
      empresa: form.empresa.value.trim(),
      mensaje: form.mensaje.value.trim(),
    };
    var falta = datos.nombre.length < 2 ? 'Contanos tu nombre.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email) ? 'Revisá el email.'
      : datos.mensaje.length < 10 ? 'Escribinos unas líneas sobre tu consulta.' : '';
    error.hidden = !falta;
    error.textContent = falta;
    if (falta) return;
    var boton = form.querySelector('button');
    boton.disabled = true; boton.textContent = 'Enviando…';
    fetch(window.WTR_API_CONTACTO, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos),
    }).then(function (r) { return r.json(); }).then(function (r) {
      if (!r.ok) throw new Error(r.error || 'error');
      Array.prototype.forEach.call(form.querySelectorAll('.campo, .campo-fila, button'), function (el) { el.hidden = true; });
      ok.hidden = false;
    }).catch(function () {
      boton.disabled = false; boton.textContent = 'Enviar consulta';
      error.hidden = false;
      error.textContent = 'No pudimos enviar la consulta. Probá de nuevo o escribinos por WhatsApp.';
    });
  });
})();
