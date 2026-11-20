# Scan Download Link

Extension Chrome untuk memindai link di tab aktif, memeriksa redirect, dan mengirim URL ke JDownloader.

## Instalasi

1. Buka `chrome://extensions` di Chrome 116 atau versi lebih baru.
2. Aktifkan **Developer mode**. Klik **Load unpacked**, lalu pilih folder `extension`.
3. Buka panel extension. Klik **Pengaturan**, lalu masuk ke MyJDownloader dan pilih perangkat, atau pilih koneksi langsung ke LAN.
4. Pindai tab aktif dan pilih URL. Gunakan **Kirim ke LinkGrabber** untuk meninjau file di JDownloader, atau **Download langsung** untuk mulai mengunduh.

Untuk mode LAN, aktifkan Deprecated Remote API di pengaturan JDownloader dan batasi akses port ke jaringan tepercaya. Penambahan atau perubahan login akun hoster memerlukan HTTPS atau koneksi localhost melalui tunnel SSH.

## Tes regresi

Jalankan dari folder proyek dengan Node.js 22 atau lebih baru.

```sh
node --test tests/*.test.cjs
```

Tes menjalankan kode extension dengan simulasi browser dan respons JDownloader.
