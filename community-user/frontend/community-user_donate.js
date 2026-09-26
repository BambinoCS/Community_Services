const donationForm = document.getElementById("donationForm");
const imagesInput = document.getElementById("images");
const previewGrid = document.getElementById("previewGrid");
const browseRequestsButton = document.getElementById("browseRequestsButton");
const message = document.getElementById("message");

imagesInput.addEventListener("change", () => {
  previewGrid.innerHTML = "";

  const files = Array.from(imagesInput.files);

  files.forEach((file) => {
    if (!file.type.startsWith("image/")) {
      return;
    }

    const reader = new FileReader();

    reader.addEventListener("load", (event) => {
      const image = document.createElement("img");
      image.src = event.target.result;
      image.alt = file.name;
      previewGrid.appendChild(image);
    });

    reader.readAsDataURL(file);
  });
});

donationForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const donationData = {
    itemName: document.getElementById("itemName").value.trim(),
    category: document.getElementById("category").value,
    description: document.getElementById("description").value.trim(),
    quantity: Number(document.getElementById("quantity").value),
    location: document.getElementById("location").value.trim(),
    availableFrom: document.getElementById("availableFrom").value,
    availableUntil: document.getElementById("availableUntil").value,
    imageCount: imagesInput.files.length
  };

  if (
    new Date(donationData.availableUntil) <=
    new Date(donationData.availableFrom)
  ) {
    message.style.display = "block";
    message.textContent =
      "Available Until must be later than Available From.";
    return;
  }

  console.log("Donation ready for Supabase:", donationData);

  message.style.display = "block";
  message.textContent =
    "Donation details are valid. Supabase upload and database saving will be connected later.";
});

browseRequestsButton.addEventListener("click", () => {
  message.style.display = "block";
  message.textContent =
    "Browse Requests will be implemented later.";
});
