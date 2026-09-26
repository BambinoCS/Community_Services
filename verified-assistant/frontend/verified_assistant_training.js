/**
 * verified-assistant_training.js
 *
 * Generic project training labels only — no official/external
 * certifications are implied, per the master prompt's instruction
 * not to invent official certifications.
 */

// TODO: replace with a real fetch() of this assistant's training
// progress once the backend exists.
const trainingModules = [
  { id: "community_safety", name: "Community Safety", required: true, status: "not_started" },
  { id: "food_delivery", name: "Food Delivery", required: true, status: "not_started" },
  { id: "vulnerable_person_care", name: "Vulnerable Person Care", required: true, status: "not_started" },
  { id: "platform_training", name: "Platform Training", required: true, status: "not_started" },
];

document.addEventListener("DOMContentLoaded", () => {
  renderModules();
  renderOverallProgress();
});

function renderModules() {
  const container = document.getElementById("modulesContainer");
  container.innerHTML = trainingModules.map((module) => `
    <article class="item-card">
      <div class="item-card-top">
        <h3>${module.name}</h3>
        ${renderStatusBadge(module.status, TRAINING_STATUS_LABELS)}
      </div>
      <p class="meta">${module.required ? "Required module" : "Optional module"}</p>
    </article>
  `).join("");
}

function renderOverallProgress() {
  const completed = trainingModules.filter((m) => m.status === "completed").length;
  const percent = trainingModules.length ? Math.round((completed / trainingModules.length) * 100) : 0;

  document.getElementById("overallProgressFill").style.width = `${percent}%`;
  document.getElementById("overallProgressLabel").textContent =
    `${completed} of ${trainingModules.length} required modules completed (${percent}%).`;
}