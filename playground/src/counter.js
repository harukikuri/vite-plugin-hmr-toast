let count = 0;
let el;
let text = "";

export function mount(button, label) {
  el = button;
  text = label;
  el.onclick = () => {
    count++;
    render();
  };
  render();
}

function render() {
  el.textContent = `${text}: ${count}`;
}

// Swap in the new module (its count starts over).
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    mod?.mount(el, text);
  });
}
