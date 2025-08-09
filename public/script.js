document.addEventListener("DOMContentLoaded", () => {
  const confirmButton = document.getElementById("confirm-button");
  const optionsMenu = document.getElementById("options-menu");
  const downloadButton = document.getElementById("download-button");
  const youtubeLinkInput = document.getElementById("youtube-link");
  const qualityOptions = document.querySelectorAll(".quality-option");
  const loadingIndicator = document.getElementById("loading-indicator");

  confirmButton.addEventListener("click", () => {
    const link = youtubeLinkInput.value;
    if (link) {
      optionsMenu.classList.add("active");
    } else {
      alert("Lütfen bir YouTube linki yapıştırın.");
    }
  });

  qualityOptions.forEach((option) => {
    option.addEventListener("click", () => {
      const prevSelected = document.querySelector(".quality-option.selected");
      if (prevSelected) {
        prevSelected.classList.remove("selected");
      }

      option.classList.add("selected");

      const format = option.dataset.format;
      const quality = option.dataset.quality;
      downloadButton.textContent = `İndir (${format.toUpperCase()} - ${quality})`;
    });
  });

  downloadButton.addEventListener("click", async () => {
    const selectedOption = document.querySelector(".quality-option.selected");
    const link = youtubeLinkInput.value;

    if (!link) {
      alert("Lütfen bir YouTube linki yapıştırın.");
      return;
    }

    if (!selectedOption) {
      alert("Lütfen bir indirme kalitesi seçin.");
      return;
    }

    // Yükleniyor durumunu başlat
    downloadButton.classList.add("loading");
    downloadButton.disabled = true;
    loadingIndicator.classList.add("active");

    const format = selectedOption.dataset.format;
    const quality = selectedOption.dataset.quality;

    try {
      const response = await fetch("/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: link, format: format, quality: quality }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = `video.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        const error = await response.json();
        alert(`Hata: ${error.error}`);
      }
    } catch (error) {
      alert("Sunucuya bağlanırken bir hata oluştu. Lütfen tekrar deneyin.");
      console.error("İndirme hatası:", error);
    } finally {
      // Yükleniyor durumunu her durumda bitir
      downloadButton.classList.remove("loading");
      downloadButton.disabled = false;
      loadingIndicator.classList.remove("active");
    }
  });
});
