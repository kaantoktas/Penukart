const express = require("express");
const { spawn } = require("child_process");
const rateLimit = require("express-rate-limit");
const app = express();
const port = process.env.PORT || 3000; // Render.com kendi PORT ortam değişkenini sağlar

// Sunucuyu aşırı isteklerden korumak için rate-limit kullanıyoruz.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 100, // Her IP için 15 dakikada 100 istek
  message: "Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.",
});
app.use(limiter);

app.use(express.json());
app.use(express.static("public")); // 'public' klasöründeki statik dosyaları sunar

// Render.com gibi bir ortamda yt-dlp'nin sistem PATH'inde olması veya
// deployment sırasında yüklenmesi gerekir. Bu yüzden sabit yolu kaldırıyoruz.
// Render üzerinde yt-dlp'yi kurduğunuzdan emin olun (örneğin, bir build scripti ile).
const YTDLP_PATH = "yt-dlp"; // <-- Yolu 'yt-dlp' olarak değiştiriyoruz

// Ana indirme endpoint'i
app.post("/download", async (req, res) => {
  let ytDlpProcess;
  let ytDlpStderrOutput = "";

  try {
    const { url, format, quality } = req.body;

    if (
      !url ||
      typeof url !== "string" ||
      (!url.includes("youtube.com/watch") && !url.includes("youtu.be/"))
    ) {
      return res.status(400).json({ error: "Geçersiz YouTube URL'si." });
    }

    // Video bilgilerini almak için yt-dlp'yi kullanıyoruz.
    // shell: true kaldırıldı ve bu durum Render ortamı için de uygundur.
    const infoArgs = [url, "--dump-json", "--no-warnings", "--no-progress"];
    const infoProcess = spawn(YTDLP_PATH, infoArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let infoStdout = "";
    let infoStderr = "";

    infoProcess.stdout.on("data", (data) => {
      infoStdout += data.toString();
    });
    infoProcess.stderr.on("data", (data) => {
      // UTF-8 olarak okumaya çalış
      const decodedError = Buffer.from(data).toString("utf8");
      console.error(`yt-dlp stderr (info): ${decodedError}`);
      infoStderr += decodedError;
    });

    await new Promise((resolve, reject) => {
      infoProcess.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          console.error(
            `yt-dlp bilgi çekme süreci ${code} koduyla kapandı. Stderr: ${infoStderr}`
          );

          if (infoStderr.includes("Sign in to confirm you’re not a bot")) {
            reject(
              new Error(
                "YouTube'un bot algılama sistemi devreye girdi. Bu video indirilemiyor olabilir. Lütfen başka bir video deneyin veya daha sonra tekrar deneyin."
              )
            );
          } else {
            reject(
              new Error(
                `Video bilgileri alınamadı (kod: ${code}). Lütfen URL'yi kontrol edin. ${infoStderr.substring(
                  0,
                  200
                )}...`
              )
            );
          }
        }
      });
      infoProcess.on("error", (err) => {
        console.error("yt-dlp bilgi çekme hatası:", err);
        reject(new Error(`Video bilgileri alınamadı: ${err.message}`));
      });
    });

    const videoInfo = JSON.parse(infoStdout);
    // Dosya adlarında güvenli karakterler kullanmak için temizleme
    const videoTitle = videoInfo.title
      .replace(/[^\w\s-]/g, "") // Alfanümerik olmayanları kaldır
      .replace(/\s+/g, "-") // Boşlukları tire ile değiştir
      .substring(0, 100); // Çok uzun başlıkları kısalt

    // yt-dlp indirme süreci için argüman dizisi
    let ytDlpArgs = [url];
    ytDlpArgs.push("-o", "-"); // Çıktıyı stdout'a yönlendir (Render ortamında dosya sistemine yazmaktan kaçınırız)
    ytDlpArgs.push("--no-warnings");
    ytDlpArgs.push("--no-progress");

    if (format === "mp3") {
      ytDlpArgs.push("-x", "--audio-format", "mp3");

      if (quality === "320kbps") {
        ytDlpArgs.push("--audio-quality", "0"); // En iyi ses kalitesi
      } else if (quality === "128kbps") {
        ytDlpArgs.push("--audio-quality", "5"); // Orta kalite
      } else if (quality === "64kbps") {
        ytDlpArgs.push("--audio-quality", "7"); // Düşük kalite
      }

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${videoTitle}.mp3"`
      );
    } else if (format === "mp4") {
      // Farklı video kaliteleri için format seçenekleri
      if (quality === "4k") {
        ytDlpArgs.push(
          "-f",
          "bestvideo[ext=mp4][height>=2160]+bestaudio[ext=m4a]/best[ext=mp4][height>=2160]/best"
        );
      } else if (quality === "1080p") {
        ytDlpArgs.push(
          "-f",
          "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best"
        );
      } else if (quality === "720p") {
        ytDlpArgs.push(
          "-f",
          "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best"
        );
      } else if (quality === "480p") {
        ytDlpArgs.push(
          "-f",
          "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best"
        );
      } else if (quality === "360p") {
        ytDlpArgs.push(
          "-f",
          "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best"
        );
      } else {
        // Varsayılan olarak en iyi mp4 formatı
        ytDlpArgs.push("-f", "best[ext=mp4]");
      }

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${videoTitle}.mp4"`
      );
    } else {
      return res
        .status(400)
        .json({ error: "Desteklenmeyen format. 'mp3' veya 'mp4' olmalı." });
    }

    ytDlpProcess = spawn(YTDLP_PATH, ytDlpArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!ytDlpProcess || !ytDlpProcess.stdout) {
      console.error(
        "yt-dlp indirme süreci geçerli bir stdout akışı döndürmedi. Stderr: " +
          ytDlpStderrOutput
      );
      return res.status(500).json({
        error:
          "İndirme akışı başlatılamadı. Lütfen konsoldaki yt-dlp hatalarını kontrol edin.",
      });
    }

    // yt-dlp çıktısını doğrudan HTTP yanıtına aktar
    ytDlpProcess.stdout.pipe(res);

    ytDlpProcess.stderr.on("data", (data) => {
      const decodedError = Buffer.from(data).toString("utf8");
      console.error(`yt-dlp stderr (download): ${decodedError}`);
      ytDlpStderrOutput += decodedError;
    });

    ytDlpProcess.on("error", (err) => {
      console.error("yt-dlp indirme süreci hatası:", err);
      if (!res.headersSent) {
        res.status(500).json({
          error: `İndirme başlatılamadı: ${err.message}. Lütfen konsolu kontrol edin.`,
        });
      }
    });

    ytDlpProcess.on("close", (code) => {
      if (code !== 0) {
        console.error(
          `yt-dlp indirme süreci ${code} koduyla kapandı. Stderr: ${ytDlpStderrOutput}`
        );
        if (ytDlpStderrOutput.includes("Sign in to confirm you’re not a bot")) {
          if (!res.headersSent) {
            res.status(500).json({
              error:
                "YouTube'un bot algılama sistemi devreye girdi. Bu video indirilemiyor olabilir. Lütfen başka bir video deneyin veya daha sonra tekrar deneyin.",
            });
          }
        } else {
          if (!res.headersSent) {
            res.status(500).json({
              error: `İndirme işlemi tamamlanamadı (kod: ${code}). Lütfen konsoldaki yt-dlp hata mesajını kontrol edin.`,
            });
          }
        }
      } else {
        console.log("İndirme işlemi yt-dlp tarafından tamamlandı.");
      }
    });
  } catch (error) {
    console.error("İndirme hatası:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: error.message || "Bir hata oluştu. Lütfen tekrar deneyin.",
      });
    }
  }
});

// Sunucuyu belirtilen port üzerinden başlat
app.listen(port, () => {
  console.log(`Sunucu http://localhost:${port} adresinde çalışıyor.`);
});
