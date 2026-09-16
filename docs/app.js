  // =====================================================================
  // GANTI URL DI BAWAH INI dengan URL Web App Apps Script kamu
  // (Deploy > New deployment > Web app, Execute as Me, Access: Anyone)
  // Contoh: "https://script.google.com/macros/s/AKfycbx.../exec"
  // File ini bisa dipakai LANGSUNG di Apps Script (sebagai Index.html)
  // MAUPUN di-hosting di GitHub Pages / hosting statis lain -- keduanya
  // memanggil Apps Script yang sama lewat fetch(), bukan google.script.run.
  // =====================================================================
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxqxElfJ_6fsUk8pWuQfcmSTs-7au2NafcardPfak0a0DA12MsVl3JVx3fRgsRGestM6w/exec";

  // Link webapps ini sendiri, dipakai di penutup teks broadcast agenda ke WA -- ganti kalau alamatnya berubah
  const SITE_LINK = "https://lmst-kopw.github.io/agendaojkpwt/";

  // ===================== HELPER KOMUNIKASI KE APPS SCRIPT =====================
  function apiGet(action, params) {
    var url = APPS_SCRIPT_URL + '?action=' + encodeURIComponent(action);
    if (params) {
      Object.keys(params).forEach(function (k) {
        url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      });
    }
    return fetch(url).then(function (r) { return r.json(); });
  }

  function apiPost(action, payload) {
    // Content-Type "text/plain" sengaja dipakai supaya browser TIDAK
    // mengirim CORS preflight (OPTIONS), karena Apps Script Web App
    // tidak bisa menjawab preflight tersebut.
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, payload: payload })
    }).then(function (r) { return r.json(); });
  }

  // ===================== STATE GLOBAL =====================
  var semuaAgenda = [];         // seluruh data agenda dari server
  var bulanAktif = new Date().getMonth() + 1;
  var tahunAktif = new Date().getFullYear();
  var filterJabatanAktif = 'SEMUA';
  var filterPeriodeAktif = 'BULAN_INI';
  var kataKunciPencarian = '';
  var isAdmin = false;
  var passwordAdminTersimpan = ''; // disimpan di memori tab ini, dikirim ulang tiap simpan/hapus (karena tidak ada sesi server)
  var agendaSedangDilihat = null; // untuk keperluan edit/hapus dari modal detail
  var pemuatanPertama = true; // true selama splash awal masih tampil

  var WARNA_JABATAN = {
    'ADK': '#34618f',
    'Kepala Kantor': '#7c1230',
    'Pegawai': '#2f7a5f',
    'Gabungan': '#7c4a9e'
  };

  // Versi lembut (bg muda + teks tua) dari warna kategori, dipakai untuk badge pill.
  var BADGE_JABATAN = {
    'ADK': { bg: '#e6eef7', fg: '#2c5480' },
    'Kepala Kantor': { bg: '#fbe9ee', fg: '#7c1230' },
    'Pegawai': { bg: '#e7f5ed', fg: '#256b3f' },
    'Gabungan': { bg: '#f3eaf8', fg: '#6b3c8a' }
  };

  function badgeJabatan(jabatan) {
    return BADGE_JABATAN[jabatan] || { bg: '#eee', fg: '#555' };
  }

  /**
   * Google Sheets kadang mengembalikan sel jam sebagai objek Date utuh
   * (jadi keluar sebagai teks panjang seperti "Sun Dec 31 1899 10:00:00
   * GMT+0700 (Waktu Indonesia Barat)"), bukan cuma "10:00". Fungsi ini
   * selalu mengambil JAM:MENIT-nya saja, dari format apa pun yang datang
   * dari server -- jadi jamnya tetap sama persis dengan yang diketik di
   * spreadsheet, cuma dirapikan tampilannya.
   */
  function ambilJamMenit(str) {
    if (!str || str === '-') return '';
    // Terima format jam "10:00" (dari Date/jam bawaan Sheets) MAUPUN
    // "10.00" (kalau kolomnya diisi manual sebagai teks pakai titik).
    var cocok = String(str).match(/(\d{1,2})[:.](\d{2})/);
    if (!cocok) return '';
    var jam = ('0' + cocok[1]).slice(-2);
    return jam + ':' + cocok[2];
  }

  /** Format jam gaya Indonesia untuk ditampilkan: "10:00" -> "10.00" */
  /**
   * Format jam gaya Indonesia untuk ditampilkan: "10:00" -> "10.00".
   * Kalau isinya bukan jam (misal diisi "TBC" di spreadsheet), tetap
   * ditampilkan apa adanya -- cuma benar-benar kosong yang jadi "-".
   */
  function formatJam(j) {
    if (!j || j === '-') return '-';
    var hm = ambilJamMenit(j);
    if (hm) return hm.replace(':', '.');
    return String(j).trim() || '-';
  }

  /** Progres kegiatan dihitung otomatis dari tanggal (tanpa perlu field tambahan di data). */
  function hitungProgresKegiatan(tanggalIso) {
    var target = new Date(tanggalIso + 'T00:00:00');
    var now = new Date(); now.setHours(0, 0, 0, 0);
    if (isSameDate(target, now)) return 'Berlangsung';
    if (target < now) return 'Selesai';
    return 'Terjadwal';
  }

  var NAMA_BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  var NAMA_HARI = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];

  // ===================== INIT =====================
  window.addEventListener('DOMContentLoaded', function () {
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('GANTI_DENGAN_URL') !== -1) {
      document.getElementById('calendarGrid').innerHTML =
        '<div class="loading-text">APPS_SCRIPT_URL belum diisi. Buka Index.html, ganti nilai APPS_SCRIPT_URL dengan URL Web App Apps Script kamu.</div>';
      pemuatanPertama = false;
      var splashAwal = document.getElementById('appSplash');
      if (splashAwal) splashAwal.classList.add('hide');
      return;
    }
    muatUlangData();
  });

  function muatUlangData() {
    var iniPemuatanPertama = pemuatanPertama;
    if (!iniPemuatanPertama) {
      var icon = document.getElementById('iconRefresh');
      if (icon) icon.classList.add('fa-spin');
    }

    apiGet('list')
      .then(function (res) {
        if (!res.sukses) throw new Error(res.pesan || 'Gagal memuat data.');
        semuaAgenda = res.data || [];
        renderSemua();
        perbaruiKartuStatusData();
      })
      .catch(function (err) {
        if (iniPemuatanPertama) {
          document.getElementById('calendarGrid').innerHTML = '<div class="loading-text">Gagal memuat data: ' + err.message + '</div>';
        }
        tampilkanToast('Gagal memuat data: ' + err.message, 'error');
      })
      .then(function () {
        if (iniPemuatanPertama) {
          pemuatanPertama = false;
          var splash = document.getElementById('appSplash');
          if (splash) splash.classList.add('hide');
        } else {
          var icon2 = document.getElementById('iconRefresh');
          if (icon2) icon2.classList.remove('fa-spin');
        }
      });
  }

  function renderSemua() {
    renderKalender();
    renderAgendaHariIni();
    renderTabelAgenda();
  }

  /** Update kartu "Status Data": jumlah total agenda + jam terakhir data disinkronkan dari server. */
  function perbaruiKartuStatusData() {
    var now = new Date();
    var jam = String(now.getHours()).padStart(2, '0');
    var menit = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('totalAgendaCount').innerText = semuaAgenda.length + ' agenda';
    document.getElementById('labelTersinkron').innerText = 'Tersinkron ' + jam + '.' + menit;
  }

  /** Pindah antara tampilan Kalender dan tampilan Tabel (bagian atas -- topbar, kartu filter -- tetap sama). */
  function gantiTampilan(target) {
    var tabel = target === 'tabel';
    document.getElementById('viewKalender').style.display = tabel ? 'none' : '';
    document.getElementById('viewTabel').style.display = tabel ? '' : 'none';
    document.getElementById('navKalender').classList.toggle('active', !tabel);
    document.getElementById('navTabel').classList.toggle('active', tabel);
    var bnmK = document.getElementById('bnmKalender');
    var bnmT = document.getElementById('bnmTabel');
    if (bnmK) bnmK.classList.toggle('active', !tabel);
    if (bnmT) bnmT.classList.toggle('active', tabel);
  }

  /** Warna teks kolom Progres di tabel. */
  function warnaProgres(progres) {
    if (progres === 'Selesai') return 'color:' + WARNA_JABATAN.Pegawai;
    if (progres === 'Berlangsung') return 'color:' + '#b68a3d';
    return 'color:var(--text-muted)';
  }

  /** Ambil daftar agenda yang sesuai filter Jabatan + Periode + pencarian aktif, terurut tanggal & jam. */
  function ambilAgendaSesuaiFilter() {
    var list = semuaAgenda.filter(function (item) { return cocokFilterDasar(item) && cocokPeriode(item.tanggal); });
    list.sort(function (a, b) {
      if (a.tanggal !== b.tanggal) return a.tanggal.localeCompare(b.tanggal);
      return ambilJamMenit(a.jamMulai).localeCompare(ambilJamMenit(b.jamMulai));
    });
    return list;
  }

  /** Render tabel "Daftar Kegiatan" di tampilan Tabel. */
  function renderTabelAgenda() {
    var body = document.getElementById('tabelAgendaBody');
    if (!body) return;
    var list = ambilAgendaSesuaiFilter();

    if (list.length === 0) {
      body.innerHTML = '<tr><td colspan="9" class="loading-text">Tidak ada agenda sesuai filter saat ini.</td></tr>';
      return;
    }

    var html = '';
    list.forEach(function (item, idx) {
      var tglObj = new Date(item.tanggal + 'T00:00:00');
      var tglFmt = String(tglObj.getDate()).padStart(2, '0') + '/' + String(tglObj.getMonth() + 1).padStart(2, '0') + '/' + tglObj.getFullYear();
      var jamMulaiFmt = formatJam(item.jamMulai);
      var jamSelesaiFmt = formatJam(item.jamSelesai);
      var jamGabung = jamMulaiFmt + (jamSelesaiFmt !== '-' && jamSelesaiFmt !== jamMulaiFmt ? (' - ' + jamSelesaiFmt) : '');
      var badge = badgeJabatan(item.jabatan);
      var progres = hitungProgresKegiatan(item.tanggal);

      html += '<tr>';
      html += '<td data-label="No">' + (idx + 1) + '</td>';
      html += '<td data-label="Tanggal">' + tglFmt + '</td>';
      html += '<td class="kolom-jam" data-label="Jam">' + jamGabung + '</td>';
      html += '<td data-label="Kategori"><span class="tabel-badge" style="background:' + badge.bg + ';color:' + badge.fg + '">' + escapeHtml(item.jabatan) + '</span></td>';
      html += '<td data-label="Nama Kegiatan">' + escapeHtml(item.judul) + '</td>';
      html += '<td data-label="Tempat/Media">' + escapeHtml(item.tempat || '-') + '</td>';
      html += '<td data-label="Dihadiri Oleh">' + escapeHtml(item.dihadiri || '-') + '</td>';
      html += '<td class="tabel-progres" data-label="Progres" style="' + warnaProgres(progres) + '">' + progres + '</td>';
      html += '<td class="tabel-aksi" data-label="Aksi"><button class="btn-detail-tabel" onclick=\'bukaDetailSatuAgenda(' + JSON.stringify(item.id) + ')\'><i class="fas fa-arrow-up-right-from-square"></i> Detail</button></td>';
      html += '</tr>';
    });
    body.innerHTML = html;
  }

  /** Buka modal detail untuk 1 agenda spesifik dari tabel -- tampilannya sama seperti modal detail di kalender,
   *  bedanya daftar di panel kiri cuma berisi 1 agenda ini saja (bukan semua agenda di tanggal itu). */
  function bukaDetailSatuAgenda(id) {
    var item = semuaAgenda.filter(function (a) { return a.id === id; })[0];
    if (!item) return;
    window._modalTglAktif = item.tanggal;
    window._modalListAktif = [item];
    window._tampilanMobileDetail = 'detail';
    renderModalDetailTanggal(item.id);
    bukaModal('modalDetailTanggal');
  }

  /** Label periode yang tampil di kop laporan, mengikuti filter Periode yang sedang aktif. */
  function labelPeriodeLaporan() {
    var now = new Date();
    if (filterPeriodeAktif === 'BULAN_INI') {
      return NAMA_BULAN[now.getMonth()] + ' ' + now.getFullYear();
    }
    if (filterPeriodeAktif === 'MINGGU_INI') {
      var awal = new Date(now); awal.setDate(now.getDate() - now.getDay());
      var akhir = new Date(awal); akhir.setDate(awal.getDate() + 6);
      return awal.getDate() + ' - ' + akhir.getDate() + ' ' + NAMA_BULAN[akhir.getMonth()] + ' ' + akhir.getFullYear();
    }
    if (filterPeriodeAktif === 'HARI_INI') {
      return now.getDate() + ' ' + NAMA_BULAN[now.getMonth()] + ' ' + now.getFullYear();
    }
    if (filterPeriodeAktif === 'BESOK') {
      var besok = new Date(now); besok.setDate(now.getDate() + 1);
      return besok.getDate() + ' ' + NAMA_BULAN[besok.getMonth()] + ' ' + besok.getFullYear();
    }
    return 'Semua';
  }

  /** Susun isi laporan (dipakai untuk Preview maupun Unduh PDF -- keduanya lewat modal + cetak bawaan browser). */
  function isiModalLaporan() {
    var list = ambilAgendaSesuaiFilter();
    var baris = list.map(function (item, idx) {
      var tglObj = new Date(item.tanggal + 'T00:00:00');
      var tglFmt = String(tglObj.getDate()).padStart(2, '0') + '/' + String(tglObj.getMonth() + 1).padStart(2, '0') + '/' + tglObj.getFullYear();
      var jamMulaiFmt = formatJam(item.jamMulai);
      var jamSelesaiFmt = formatJam(item.jamSelesai);
      var jamGabung = jamMulaiFmt + (jamSelesaiFmt !== '-' && jamSelesaiFmt !== jamMulaiFmt ? (' - ' + jamSelesaiFmt) : '');
      return '<tr>' +
        '<td>' + (idx + 1) + '</td>' +
        '<td>' + tglFmt + '</td>' +
        '<td class="kolom-jam">' + jamGabung + '</td>' +
        '<td>' + escapeHtml(item.jabatan) + '</td>' +
        '<td>' + escapeHtml(item.judul) + '</td>' +
        '<td>' + escapeHtml(item.tempat || '-') + '</td>' +
        '<td>' + escapeHtml(item.dihadiri || '-') + '</td>' +
        '<td>' + hitungProgresKegiatan(item.tanggal) + '</td>' +
        '</tr>';
    }).join('');

    if (list.length === 0) {
      baris = '<tr><td colspan="8" style="text-align:center;color:#888;">Tidak ada agenda sesuai filter saat ini.</td></tr>';
    }

    var html = '<div class="laporan-header">' +
      '<img src="assets/logo-ojk.png" alt="Logo OJK" class="laporan-logo">' +
      '<div class="laporan-judul-group">' +
      '<div class="laporan-judul-utama">Laporan Agenda Kegiatan</div>' +
      '<div class="laporan-judul-sub">Kantor OJK Purwokerto</div>' +
      '<div class="laporan-periode">Periode : ' + labelPeriodeLaporan() + '</div>' +
      '</div>' +
      '</div>' +
      '<table class="laporan-tabel"><thead><tr>' +
      '<th>No</th><th>Tanggal</th><th class="kolom-jam">Jam</th><th>Kategori</th><th>Nama Kegiatan</th><th>Tempat/Media</th><th>Dihadiri Oleh</th><th>Progres</th>' +
      '</tr></thead><tbody>' + baris + '</tbody></table>' +
      '<div class="laporan-footer">' +
      '<div class="laporan-footer-alamat">Kantor OJK Purwokerto, Jl. Jend. Gatot Subroto No. 46, Sokanegara, Kec. Purwokerto Tim., Kabupaten Banyumas, Jawa Tengah 53115</div>' +
      '</div>';

    document.getElementById('modalLaporanCetak').innerHTML = html;
  }

  function previewLaporanPdf() {
    isiModalLaporan();
    bukaModal('modalLaporan');
  }

  function unduhLaporanPdf() {
    isiModalLaporan();
    bukaModal('modalLaporan');
    setTimeout(function () { window.print(); }, 250);
  }

  /** Ambil nama-nama unik dari kolom "Dihadiri" seluruh agenda yang diberikan (dipisah tiap koma). */
  /** Gabung array jadi kalimat gaya Indonesia: "A, B dan C". */
  function gabungDenganDan(list) {
    if (list.length === 0) return '';
    if (list.length === 1) return list[0];
    return list.slice(0, -1).join(', ') + ' dan ' + list[list.length - 1];
  }

  /**
   * Susun teks agenda BESOK (relatif terhadap tanggal hari ini di perangkat admin) lalu buka
   * WhatsApp dengan teks tersebut sudah terisi di kotak chat. Admin tetap harus memilih sendiri
   * grup/kontak tujuan sebelum menekan kirim -- WhatsApp tidak menyediakan cara resmi untuk
   * langsung memilihkan grup tujuan tanpa WhatsApp Business API.
   * Sengaja mengambil SEMUA agenda besok (tidak mengikuti filter Jabatan/Periode yang sedang
   * aktif di layar), karena tujuannya adalah broadcast agenda kantor secara menyeluruh.
   */
  function kirimAgendaBesokKeWa() {
    var besok = new Date();
    besok.setDate(besok.getDate() + 1);
    var tglIsoBesok = besok.getFullYear() + '-' + String(besok.getMonth() + 1).padStart(2, '0') + '-' + String(besok.getDate()).padStart(2, '0');

    var listBesok = semuaAgenda.filter(function (item) { return item.tanggal === tglIsoBesok; });
    listBesok.sort(function (a, b) { return ambilJamMenit(a.jamMulai).localeCompare(ambilJamMenit(b.jamMulai)); });

    var labelTanggal = NAMA_HARI[besok.getDay()] + ', ' + besok.getDate() + ' ' + NAMA_BULAN[besok.getMonth()] + ' ' + besok.getFullYear();

    // Nama sapaan tetap (bukan diambil otomatis dari kolom "Dihadiri" agenda)
    var namaSapaanTetap = ['Bu Dina', 'Bu Winti', 'Bu Yenni'];
    var daftarSapaan = namaSapaanTetap.concat(['Bapak/Ibu Pejabat serta rekan-rekan pegawai']);

    var teks = 'Selamat malam ' + gabungDenganDan(daftarSapaan) + '\n';
    teks += 'Mohon izin kami sampaikan agenda ' + labelTanggal + ' sbb:\n\n';

    if (listBesok.length === 0) {
      teks += 'Tidak ada agenda yang terjadwal untuk besok.\n\n';
    } else {
      listBesok.forEach(function (item, idx) {
        var jamMulaiFmt = formatJam(item.jamMulai);
        var jamSelesaiFmt = formatJam(item.jamSelesai);
        var jamGabung = jamMulaiFmt + (jamSelesaiFmt !== '-' && jamSelesaiFmt !== jamMulaiFmt ? ('- ' + jamSelesaiFmt) : '');
        teks += (idx + 1) + ') ' + item.judul + '\n\n';
        teks += '* Waktu    : ' + jamGabung + ' WIB\n';
        teks += '* Tempat    : ' + (item.tempat || '-') + '\n';
        teks += '* Dihadiri    : ' + (item.dihadiri || '-') + '\n\n';
      });
    }

    teks += 'Selanjutnya dalam rangka Monitoring Agenda Kepala dan Pegawai KOPW 2026, bersama ini kami sampaikan webapps Agenda OJK Purwokerto untuk kroscek agenda tersebut, yang dapat diakses melalui link berikut :\n';
    teks += SITE_LINK + '\n\n';
    teks += 'Demikian kami sampaikan, terima kasih.';

    var urlWa = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(teks.trim());
    window.open(urlWa, '_blank');
  }

  // ===================== FILTER =====================
  function setFilterJabatan(val, btnEl) {
    filterJabatanAktif = val;
    document.querySelectorAll('#pillJabatan .pill-btn').forEach(function (b) { b.classList.remove('active'); });
    btnEl.classList.add('active');
    renderSemua();
  }

  function setFilterPeriode(val, btnEl) {
    filterPeriodeAktif = val;
    document.querySelectorAll('#pillPeriode .pill-btn').forEach(function (b) { b.classList.remove('active'); });
    btnEl.classList.add('active');
    renderSemua();
  }

  function onSearchChange() {
    kataKunciPencarian = document.getElementById('inputPencarian').value.trim().toLowerCase();
    renderSemua();
  }

  /** Cocok dengan filter Jabatan + kata kunci pencarian (dipakai untuk isi kalender). */
  function cocokFilterDasar(item) {
    if (filterJabatanAktif !== 'SEMUA' && item.jabatan !== filterJabatanAktif) return false;
    if (kataKunciPencarian) {
      var gabungan = (item.judul + ' ' + item.tempat + ' ' + item.dihadiri + ' ' + item.nomorSurat).toLowerCase();
      if (gabungan.indexOf(kataKunciPencarian) === -1) return false;
    }
    return true;
  }

  /** Tambahan cek periode (dipakai untuk meredupkan tanggal di luar periode terpilih). */
  function cocokPeriode(tanggalIso) {
    if (filterPeriodeAktif === 'SEMUA') return true;
    var target = new Date(tanggalIso + 'T00:00:00');
    var now = new Date(); now.setHours(0,0,0,0);

    if (filterPeriodeAktif === 'HARI_INI') {
      return isSameDate(target, now);
    }
    if (filterPeriodeAktif === 'BESOK') {
      var besok = new Date(now); besok.setDate(besok.getDate() + 1);
      return isSameDate(target, besok);
    }
    if (filterPeriodeAktif === 'MINGGU_INI') {
      var awalMinggu = new Date(now); awalMinggu.setDate(now.getDate() - now.getDay());
      var akhirMinggu = new Date(awalMinggu); akhirMinggu.setDate(awalMinggu.getDate() + 6);
      return target >= awalMinggu && target <= akhirMinggu;
    }
    if (filterPeriodeAktif === 'BULAN_INI') {
      return target.getMonth() === now.getMonth() && target.getFullYear() === now.getFullYear();
    }
    return true;
  }

  function isSameDate(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  // ===================== NAVIGASI BULAN =====================
  function gantiBulan(delta) {
    bulanAktif += delta;
    if (bulanAktif > 12) { bulanAktif = 1; tahunAktif++; }
    if (bulanAktif < 1) { bulanAktif = 12; tahunAktif--; }
    renderKalender();
  }

  function kembaliKeBulanIni() {
    var skrg = new Date();
    bulanAktif = skrg.getMonth() + 1;
    tahunAktif = skrg.getFullYear();
    renderKalender();
  }

  // ===================== RENDER KALENDER =====================
  function renderKalender() {
    document.getElementById('labelBulanTahun').innerText = NAMA_BULAN[bulanAktif - 1] + ' ' + tahunAktif;

    var jumlahHari = new Date(tahunAktif, bulanAktif, 0).getDate();
    var hariPertama = new Date(tahunAktif, bulanAktif - 1, 1).getDay();

    // Kelompokkan agenda (yang lolos filter dasar) per tanggal ISO, khusus bulan yang sedang ditampilkan
    var agendaPerTanggal = {};
    semuaAgenda.forEach(function (item) {
      if (!cocokFilterDasar(item)) return;
      var d = new Date(item.tanggal + 'T00:00:00');
      if (d.getMonth() !== (bulanAktif - 1) || d.getFullYear() !== tahunAktif) return;
      if (!agendaPerTanggal[item.tanggal]) agendaPerTanggal[item.tanggal] = [];
      agendaPerTanggal[item.tanggal].push(item);
    });

    var now = new Date();
    var html = '';

    // Sel awal (sebelum tanggal 1) -> tampilkan angka akhir bulan sebelumnya, pudar & tidak bisa diklik
    var jumlahHariBulanLalu = new Date(tahunAktif, bulanAktif - 1, 0).getDate();
    for (var i = 0; i < hariPertama; i++) {
      var angkaBulanLalu = jumlahHariBulanLalu - hariPertama + 1 + i;
      html += '<div class="day-cell luar-bulan"><div class="day-number">' + angkaBulanLalu + '</div></div>';
    }

    for (var d = 1; d <= jumlahHari; d++) {
      var tglIso = tahunAktif + '-' + String(bulanAktif).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var listHariIni = agendaPerTanggal[tglIso] || [];
      var isHariIni = isSameDate(new Date(tahunAktif, bulanAktif - 1, d), now);
      var diLuarPeriode = !cocokPeriode(tglIso);

      var kelas = 'day-cell' + (isHariIni ? ' hari-ini' : '') + (listHariIni.length > 0 ? ' ada-agenda' : '');
      var opacityStyle = (diLuarPeriode && filterPeriodeAktif !== 'SEMUA') ? ' style="opacity:0.35;"' : '';
      var klik = listHariIni.length > 0 ? (' onclick="bukaDetailTanggal(\'' + tglIso + '\')"') : '';

      html += '<div class="' + kelas + '"' + opacityStyle + klik + '>';
      html += '<div class="day-number">' + d + '</div>';
      html += '<div class="day-agenda-list">';

      var maxTampil = 4;
      for (var j = 0; j < Math.min(listHariIni.length, maxTampil); j++) {
        var it = listHariIni[j];
        var warna = WARNA_JABATAN[it.jabatan] || '#888';
        var badgeChip = badgeJabatan(it.jabatan);
        var labelChip = (it.jamMulai && it.jamMulai !== '-') ? (formatJam(it.jamMulai) + ' &middot; ' + escapeHtml(it.judul)) : escapeHtml(it.judul);
        html += '<div class="day-agenda-chip" style="background:' + badgeChip.bg + ';color:' + badgeChip.fg + ';border-left-color:' + warna + ';--warna-kuat:' + warna + '" title="' + escapeHtml((it.jamMulai && it.jamMulai !== '-' ? formatJam(it.jamMulai) + ' - ' : '') + it.judul) + '">' + labelChip + '</div>';
      }
      if (listHariIni.length > maxTampil) {
        html += '<div class="day-agenda-more">+' + (listHariIni.length - maxTampil) + ' lainnya</div>';
      }
      html += '</div>';

      // Indikator khusus layar sangat sempit (<=480px): 1 agenda -> dot warna kategori;
      // lebih dari 1 -> teks "+N agenda" (di layar lebih lebar, blok ini disembunyikan lewat CSS).
      if (listHariIni.length === 1) {
        var warnaSatu = WARNA_JABATAN[listHariIni[0].jabatan] || '#888';
        html += '<div class="day-mobile-indicator"><span class="dmi-dot" style="background:' + warnaSatu + '"></span></div>';
      } else if (listHariIni.length > 1) {
        html += '<div class="day-mobile-indicator"><span class="dmi-count">' + listHariIni.length + ' agenda</span></div>';
      }

      html += '</div>';
    }

    // Sel akhir (setelah tanggal terakhir) -> tampilkan angka awal bulan berikutnya, pudar & tidak bisa diklik,
    // supaya baris terakhir tetap penuh 7 kolom tanpa ikut memuat agenda bulan berikutnya.
    var totalSelTerisi = hariPertama + jumlahHari;
    var sisaKolom = totalSelTerisi % 7;
    if (sisaKolom !== 0) {
      var jumlahPengisi = 7 - sisaKolom;
      for (var k = 1; k <= jumlahPengisi; k++) {
        html += '<div class="day-cell luar-bulan"><div class="day-number">' + k + '</div></div>';
      }
    }

    document.getElementById('calendarGrid').innerHTML = html;
    window._agendaPerTanggalAktif = agendaPerTanggal;
  }

  /** Buka modal Detail Agenda untuk 1 tanggal: kiri daftar semua agenda tanggal itu, kanan detail agenda terpilih. */
  function bukaDetailTanggal(tglIso, idTerpilih) {
    var list = semuaAgenda.filter(function (item) { return item.tanggal === tglIso; });
    if (list.length === 0) return;
    list.sort(function (a, b) { return ambilJamMenit(a.jamMulai).localeCompare(ambilJamMenit(b.jamMulai)); });

    window._modalTglAktif = tglIso;
    window._modalListAktif = list;

    var idAktif = idTerpilih && list.some(function (it) { return it.id === idTerpilih; }) ? idTerpilih : list[0].id;
    // Di HP: kalau dibuka dari tanggal dengan banyak agenda tanpa agenda spesifik yang dipilih -> tampilkan daftar dulu.
    // Kalau agenda spesifiknya sudah jelas (misal dari kartu "Agenda Hari Ini") atau cuma 1 agenda -> langsung ke detail.
    window._tampilanMobileDetail = (!idTerpilih && list.length > 1) ? 'list' : 'detail';
    renderModalDetailTanggal(idAktif);
    bukaModal('modalDetailTanggal');
  }

  /** Terapkan tampilan daftar/detail di HP (mode master-detail, tidak keduanya sekaligus). */
  function terapkanTampilanMobileModal() {
    var body = document.querySelector('#modalDetailTanggal .detailtgl-body');
    if (!body) return;
    body.classList.toggle('mobile-tampil-list', window._tampilanMobileDetail === 'list');
  }

  function renderModalDetailTanggal(idAktif) {
    var list = window._modalListAktif || [];
    var tglIso = window._modalTglAktif;
    var tglObj = new Date(tglIso + 'T00:00:00');

    document.getElementById('detailTglJudul').innerText = NAMA_HARI[tglObj.getDay()] + ', ' + tglObj.getDate() + ' ' + NAMA_BULAN[tglObj.getMonth()] + ' ' + tglObj.getFullYear();

    var htmlList = '';
    var itemAktif = list[0];
    list.forEach(function (item) {
      var isAktif = item.id === idAktif;
      if (isAktif) itemAktif = item;
      var badge = badgeJabatan(item.jabatan);
      htmlList += '<div class="detailtgl-list-item' + (isAktif ? ' aktif' : '') + '" onclick=\'pilihAgendaDariDaftarTanggal(' + JSON.stringify(item.id) + ')\'>';
      htmlList += '<span class="detailtgl-list-badge" style="background:' + badge.bg + ';color:' + badge.fg + '">' + escapeHtml(item.jabatan) + '</span>';
      htmlList += '<div class="detailtgl-list-title">' + escapeHtml(item.judul) + '</div>';
      htmlList += '<div class="detailtgl-list-meta">' + formatJam(item.jamMulai) + ' &middot; ' + escapeHtml(item.tempat || '-') + '</div>';
      htmlList += '</div>';
    });
    document.getElementById('detailTglList').innerHTML = htmlList;

    agendaSedangDilihat = itemAktif;

    var jamMulaiFmt = formatJam(itemAktif.jamMulai);
    var jamSelesaiFmt = formatJam(itemAktif.jamSelesai);
    var jamText = jamMulaiFmt + (jamSelesaiFmt !== '-' && jamSelesaiFmt !== jamMulaiFmt ? (' - ' + jamSelesaiFmt) : '');
    var linkValue = itemAktif.link ? '<a href="' + itemAktif.link + '" target="_blank" rel="noopener">' + escapeHtml(itemAktif.link) + '</a>' : '-';

    var htmlFields = '';
    if (list.length > 1) {
      htmlFields += '<button class="detailtgl-kembali" onclick="kembaliKeListDetail()"><i class="fas fa-arrow-left"></i> Kembali ke daftar</button>';
    }
    htmlFields += '<div class="detailtgl-grid">';
    htmlFields += campoDetail('Progres Kegiatan', hitungProgresKegiatan(itemAktif.tanggal));
    htmlFields += campoDetail('Nomor Surat', itemAktif.nomorSurat || '-');
    htmlFields += campoDetail('Tanggal Kegiatan', tglObj.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }));
    htmlFields += campoDetail('Jam Kegiatan', jamText);
    htmlFields += campoDetail('Nama Kegiatan', escapeHtml(itemAktif.judul), true);
    htmlFields += campoDetail('Tempat Kegiatan', escapeHtml(itemAktif.tempat || '-'));
    htmlFields += campoDetail('Kategori Agenda', escapeHtml(itemAktif.jabatan));
    htmlFields += campoDetail('Link Kegiatan Daring', linkValue, false, true);
    htmlFields += campoDetail('Dihadiri Oleh', escapeHtml(itemAktif.dihadiri || '-'));
    if (itemAktif.keterangan) htmlFields += campoDetail('Keterangan', escapeHtml(itemAktif.keterangan), true);
    htmlFields += '</div>';

    if (isAdmin) {
      htmlFields += '<div class="detailtgl-foot">' +
        '<button class="btn-flat btn-flat-edit" onclick="editAgendaDariDetail()"><i class="fas fa-pen"></i> Edit</button>' +
        '<button class="btn-flat btn-flat-hapus" onclick="hapusAgendaDariDetail()"><i class="fas fa-trash"></i> Hapus</button>' +
        '</div>';
    }

    document.getElementById('detailTglFields').innerHTML = htmlFields;
    terapkanTampilanMobileModal();
  }

  /** Bikin 1 kotak field (label + value) untuk panel detail. span2 = melebar 1 baris penuh. */
  function campoDetail(label, value, span2, sudahHtml) {
    return '<div class="detailtgl-field' + (span2 ? ' span2' : '') + '">' +
      '<div class="detailtgl-field-label">' + label + '</div>' +
      '<div class="detailtgl-field-value">' + (sudahHtml ? value : value) + '</div>' +
      '</div>';
  }

  function pilihAgendaDariDaftarTanggal(id) {
    window._tampilanMobileDetail = 'detail';
    renderModalDetailTanggal(id);
  }

  /** Tombol "Kembali ke daftar" di panel detail (khusus tampilan HP). */
  function kembaliKeListDetail() {
    window._tampilanMobileDetail = 'list';
    terapkanTampilanMobileModal();
  }

  // ===================== RENDER PANEL HARI INI =====================
  function renderAgendaHariIni() {
    var now = new Date();
    var tglIsoHariIni = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    document.getElementById('labelTanggalHariIni').innerText = NAMA_HARI[now.getDay()] + ', ' + now.getDate() + ' ' + NAMA_BULAN[now.getMonth()] + ' ' + now.getFullYear();

    var listHariIni = semuaAgenda.filter(function (item) {
      return item.tanggal === tglIsoHariIni && cocokFilterDasar(item);
    });

    var labelJumlah = document.getElementById('labelJumlahAgendaHariIni');
    if (labelJumlah) labelJumlah.innerText = listHariIni.length + ' acara pada tanggal ini';

    var cont = document.getElementById('daftarAgendaHariIni');
    if (listHariIni.length === 0) {
      cont.innerHTML = '<div class="empty-state"><i class="fas fa-mug-hot"></i>Tidak ada agenda untuk hari ini.</div>';
      return;
    }

    listHariIni.sort(function(a,b){ return ambilJamMenit(a.jamMulai).localeCompare(ambilJamMenit(b.jamMulai)); });

    var html = '';
    listHariIni.forEach(function (item) {
      var warna = WARNA_JABATAN[item.jabatan] || '#888';
      var badge = badgeJabatan(item.jabatan);
      var mode = item.link ? 'Daring' : 'Fisik';
      html += '<div class="agenda-card" style="border-left-color:' + warna + '" onclick=\'bukaDetailTanggal(' + JSON.stringify(item.tanggal) + ',' + JSON.stringify(item.id) + ')\'>';
      html += '<div class="agenda-card-top">';
      html += '<span class="agenda-card-badge" style="background:' + badge.bg + ';color:' + badge.fg + '">' + escapeHtml(item.jabatan) + '</span>';
      var labelWaktu = formatJam(item.jamMulai);
      if (ambilJamMenit(item.jamMulai)) labelWaktu += ' WIB';
      html += '<span class="agenda-card-time"><i class="fas fa-clock"></i> ' + labelWaktu + '</span>';
      html += '</div>';
      html += '<div class="agenda-card-title">' + escapeHtml(item.judul) + '</div>';
      html += '<div class="agenda-card-grid">';
      html += '<div class="agenda-card-field"><div class="agenda-card-field-label"><i class="fas fa-location-dot"></i> Tempat</div><div class="agenda-card-field-value">' + escapeHtml(item.tempat || '-') + '</div></div>';
      html += '<div class="agenda-card-field"><div class="agenda-card-field-label"><i class="fas fa-users"></i> Dihadiri</div><div class="agenda-card-field-value">' + escapeHtml(item.dihadiri || '-') + '</div></div>';
      html += '<div class="agenda-card-field"><div class="agenda-card-field-label"><i class="fas fa-envelope"></i> Nomor Surat</div><div class="agenda-card-field-value">' + escapeHtml(item.nomorSurat || '-') + '</div></div>';
      html += '<div class="agenda-card-field"><div class="agenda-card-field-label"><i class="fas fa-wifi"></i> Mode</div><div class="agenda-card-field-value">' + mode + '</div></div>';
      html += '</div>';
      html += '<div class="agenda-card-foot"><span class="agenda-card-detail-btn"><i class="fas fa-arrow-up-right-from-square"></i> Detail</span></div>';
      html += '</div>';
    });
    cont.innerHTML = html;
  }

  function editAgendaDariDetail() {
    if (!agendaSedangDilihat) return;
    tutupModal('modalDetailTanggal');
    bukaFormAgenda(agendaSedangDilihat);
  }

  function hapusAgendaDariDetail() {
    if (!agendaSedangDilihat) return;
    var judulEl = document.getElementById('konfirmasiHapusJudul');
    if (judulEl) judulEl.innerHTML = 'Agenda <strong>"' + escapeHtml(agendaSedangDilihat.judul) + '"</strong> akan dihapus dan tidak bisa dikembalikan lagi.';
    bukaModal('modalKonfirmasiHapus');
  }

  /** Dipanggil dari tombol "Ya, Hapus" di modal konfirmasi hapus agenda. */
  function konfirmasiHapusAgenda() {
    if (!agendaSedangDilihat) return;
    tutupModal('modalKonfirmasiHapus');

    apiPost('hapus', { id: agendaSedangDilihat.id, password: passwordAdminTersimpan })
      .then(function (res) {
        if (res.sukses) {
          tampilkanToast(res.pesan, 'success');
          tutupModal('modalDetailTanggal');
          muatUlangData();
        } else {
          tampilkanToast(res.pesan, 'error');
        }
      })
      .catch(function (err) { tampilkanToast('Gagal menghapus: ' + err.message, 'error'); });
  }

  // ===================== ADMIN: LOGIN =====================
  function onKlikTombolAdmin() {
    if (isAdmin) {
      // sudah login -> klik lagi untuk minta konfirmasi keluar (modal custom, bukan confirm() bawaan browser)
      bukaModal('modalKonfirmasiLogout');
      return;
    }
    document.getElementById('inputPasswordAdmin').value = '';
    sembunyikanErrorLogin();
    bukaModal('modalLogin');
    setTimeout(function () { document.getElementById('inputPasswordAdmin').focus(); }, 150);
  }

  /** Dipanggil dari tombol "Ya, Keluar" di modal konfirmasi logout. */
  function konfirmasiLogoutAdmin() {
    isAdmin = false;
    passwordAdminTersimpan = '';
    document.getElementById('btnAdmin').classList.remove('is-active-admin');
    document.getElementById('labelBtnAdmin').innerText = 'Admin';
    var bnmA1 = document.getElementById('bnmAdmin');
    if (bnmA1) bnmA1.classList.remove('is-active-admin');
    var bnmAL1 = document.getElementById('bnmAdminLabel');
    if (bnmAL1) bnmAL1.innerText = 'Admin';
    var bnmWa1 = document.getElementById('bnmWa');
    if (bnmWa1) bnmWa1.style.display = 'none';
    document.getElementById('adminBar').classList.remove('show');
    tutupModal('modalKonfirmasiLogout');
    renderSemua();
  }

  /** Tampilkan pesan error di dalam modal Login (bukan toast) -- lebih kelihatan karena tepat di bawah kolom password. */
  function tampilkanErrorLogin(pesan) {
    var box = document.getElementById('loginErrorBox');
    box.innerHTML = '<i class="fas fa-circle-exclamation"></i> ' + escapeHtml(pesan);
    box.style.display = 'flex';
  }
  function sembunyikanErrorLogin() {
    var box = document.getElementById('loginErrorBox');
    box.style.display = 'none';
    box.innerHTML = '';
  }

  function submitLoginAdmin() {
    var pass = document.getElementById('inputPasswordAdmin').value;
    if (!pass) { tampilkanErrorLogin('Masukkan password admin!'); return; }

    apiPost('login', { password: pass })
      .then(function (res) {
        if (res.sukses) {
          isAdmin = true;
          passwordAdminTersimpan = pass; // dikirim ulang tiap simpan/hapus untuk verifikasi di server
          document.getElementById('btnAdmin').classList.add('is-active-admin');
          document.getElementById('labelBtnAdmin').innerText = 'Admin Aktif';
          var bnmA2 = document.getElementById('bnmAdmin');
          if (bnmA2) bnmA2.classList.add('is-active-admin');
          var bnmAL2 = document.getElementById('bnmAdminLabel');
          if (bnmAL2) bnmAL2.innerText = 'Admin Aktif';
          var bnmWa2 = document.getElementById('bnmWa');
          if (bnmWa2) bnmWa2.style.display = 'flex';
          document.getElementById('adminBar').classList.add('show');
          tutupModal('modalLogin');
          renderSemua();
        } else {
          tampilkanErrorLogin(res.pesan);
        }
      })
      .catch(function (err) { tampilkanErrorLogin('Gagal login: ' + err.message); });
  }

  // ===================== ADMIN: FORM TAMBAH / EDIT =====================
  function bukaFormAgenda(itemUntukEdit) {
    var form = document.getElementById('formAgenda');
    form.reset();

    if (itemUntukEdit) {
      document.getElementById('judulModalForm').innerText = 'Edit Agenda';
      document.getElementById('fId').value = itemUntukEdit.id;
      document.getElementById('fNomorSurat').value = itemUntukEdit.nomorSurat === '-' ? '' : itemUntukEdit.nomorSurat;
      document.getElementById('fJabatan').value = itemUntukEdit.jabatan;
      document.getElementById('fJudul').value = itemUntukEdit.judul;
      document.getElementById('fTanggal').value = itemUntukEdit.tanggal;
      document.getElementById('fJamMulai').value = ambilJamMenit(itemUntukEdit.jamMulai);
      document.getElementById('fJamSelesai').value = ambilJamMenit(itemUntukEdit.jamSelesai);
      document.getElementById('fTempat').value = itemUntukEdit.tempat === '-' ? '' : itemUntukEdit.tempat;
      document.getElementById('fDihadiri').value = itemUntukEdit.dihadiri === '-' ? '' : itemUntukEdit.dihadiri;
      document.getElementById('fLink').value = itemUntukEdit.link || '';
      document.getElementById('fKeterangan').value = itemUntukEdit.keterangan || '';
    } else {
      document.getElementById('judulModalForm').innerText = 'Tambah Agenda Baru';
      document.getElementById('fId').value = '';
    }
    bukaModal('modalForm');
  }

  function submitFormAgenda(e) {
    e.preventDefault();
    var btn = document.getElementById('btnSubmitForm');
    btn.disabled = true;
    btn.innerText = 'Menyimpan...';

    var data = {
      id: document.getElementById('fId').value,
      nomorSurat: document.getElementById('fNomorSurat').value,
      jabatan: document.getElementById('fJabatan').value,
      judul: document.getElementById('fJudul').value,
      tanggal: document.getElementById('fTanggal').value,
      jamMulai: document.getElementById('fJamMulai').value,
      jamSelesai: document.getElementById('fJamSelesai').value,
      tempat: document.getElementById('fTempat').value,
      dihadiri: document.getElementById('fDihadiri').value,
      link: document.getElementById('fLink').value,
      keterangan: document.getElementById('fKeterangan').value,
      password: passwordAdminTersimpan
    };

    apiPost('simpan', data)
      .then(function (res) {
        btn.disabled = false;
        btn.innerText = 'Simpan Agenda';
        if (res.sukses) {
          tampilkanToast(res.pesan, 'success');
          tutupModal('modalForm');
          muatUlangData();
        } else {
          tampilkanToast(res.pesan, 'error');
        }
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.innerText = 'Simpan Agenda';
        tampilkanToast('Gagal menyimpan: ' + err.message, 'error');
      });
  }

  // ===================== UTILITAS MODAL / TOAST =====================
  function bukaModal(id) { document.getElementById(id).classList.add('show'); }
  function tutupModal(id) { document.getElementById(id).classList.remove('show'); }

  document.querySelectorAll('.modal-overlay').forEach(function (ov) {
    ov.addEventListener('click', function (e) {
      if (e.target === ov) ov.classList.remove('show');
    });
  });

  function tampilkanToast(pesan, jenis) {
    var container = document.getElementById('toastContainer');
    var toast = document.createElement('div');
    toast.className = 'toast ' + (jenis || 'success');
    toast.innerText = pesan;
    container.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3200);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }