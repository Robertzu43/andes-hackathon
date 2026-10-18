// Demonstration only: never calls an API or records trip/contact information.
for (const button of document.querySelectorAll('[data-demo]')) {
  button.addEventListener('click', () => {
    const feedback = button.closest('article').querySelector('.feedback');
    if (feedback) feedback.textContent = button.closest('[lang="pt-BR"]')
      ? 'Demonstração: nenhum aviso foi enviado.'
      : 'Demostración: no se envió ningún aviso.';
  });
}
document.querySelector('#large-text').addEventListener('change', (event) => {
  document.querySelector('.controls').classList.toggle('enlarged', event.target.checked);
});
