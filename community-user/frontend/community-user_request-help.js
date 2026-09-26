const notice = document.getElementById("notice");
const featureButtons = document.querySelectorAll("[data-feature]");
const helplineButton = document.getElementById("helplineButton");

featureButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const featureName = button.dataset.feature;

    notice.style.display = "block";
    notice.textContent =
      `${featureName} has been selected. The detailed form will be implemented later.`;
  });
});

helplineButton.addEventListener("click", () => {
  notice.style.display = "block";
  notice.textContent =
    "Helpline feature selected. Contact details and live help can be connected later.";
});
