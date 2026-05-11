/* ============================================================
   SISTEM ANTRIAN RUMAH SAKIT – POLI PENYAKIT DALAM
   ============================================================ */

// ============================================================
// KONFIGURASI
// ============================================================

/**
 * Jadwal dokter per hari (0 = Minggu … 6 = Sabtu).
 * arrivalTime  : waktu dokter tiba di rumah sakit (info untuk pasien).
 * startTime    : waktu konsultasi pertama dimulai (dasar hitung estimasi).
 * endTime      : waktu konsultasi berakhir.
 * maxQueue     : kuota antrian per hari.
 * doctor       : nama dokter yang bertugas.
 */
const DOCTOR_SCHEDULE = {
  0: null,  // Minggu – Tutup
  1: { doctor: 'dr. Budi Santoso, Sp.PD', arrivalTime: '08:30', startTime: '09:00', endTime: '13:00', maxQueue: 30 },
  2: { doctor: 'dr. Budi Santoso, Sp.PD', arrivalTime: '08:30', startTime: '09:00', endTime: '13:00', maxQueue: 30 },
  3: { doctor: 'dr. Budi Santoso, Sp.PD', arrivalTime: '08:30', startTime: '09:00', endTime: '13:00', maxQueue: 30 },
  4: { doctor: 'dr. Budi Santoso, Sp.PD', arrivalTime: '08:30', startTime: '09:00', endTime: '13:00', maxQueue: 30 },
  5: { doctor: 'dr. Budi Santoso, Sp.PD', arrivalTime: '08:30', startTime: '09:00', endTime: '13:00', maxQueue: 30 },
  6: { doctor: 'dr. Siti Rahayu, Sp.PD',  arrivalTime: '08:00', startTime: '08:30', endTime: '12:00', maxQueue: 20 },
};

const AVG_MINUTES  = 10;    // rata-rata durasi konsultasi per pasien
const ARRIVE_EARLY = 15;    // menit lebih awal yang disarankan
const MAX_AHEAD_DAYS = 7;   // pendaftaran dibuka maks H-7
const STORAGE_KEY  = 'rsud_queues_v1';

const DAYS_ID   = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTHS_ID = ['Januari','Februari','Maret','April','Mei','Juni',
                   'Juli','Agustus','September','Oktober','November','Desember'];

// ============================================================
// UTILITAS PENYIMPANAN
// ============================================================

function getQueues() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueues(queues) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queues));
}

/** Kembalikan antrian aktif (bukan dibatalkan) untuk tanggal tertentu. */
function getActiveQueuesByDate(dateStr) {
  return getQueues().filter(q => q.date === dateStr && q.status !== 'cancelled');
}

// ============================================================
// UTILITAS TANGGAL & WAKTU
// ============================================================

/** Tanggal hari ini dalam format YYYY-MM-DD (waktu lokal). */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Tambahkan sejumlah hari ke sebuah tanggal (format YYYY-MM-DD). */
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Tambahkan sejumlah menit ke string waktu HH:MM; kembalikan HH:MM. */
function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total  = h * 60 + m + minutes;
  const hh     = Math.floor(total / 60);
  const mm     = total % 60;
  if (hh < 0 || hh > 23) return timeStr; // fallback
  return `${pad(hh)}:${pad(mm)}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

/** Hari dalam seminggu (0–6) dari YYYY-MM-DD. */
function getDow(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDay();
}

/** Format tanggal ke "DD Bulan YYYY". */
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
}

/** Format ISO datetime ke "DD Bulan YYYY HH:MM". */
function formatDateTime(isoStr) {
  const d = new Date(isoStr);
  return `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================
// UTILITAS KEAMANAN – Escape HTML (cegah XSS)
// ============================================================

function escHtml(str) {
  const el = document.createElement('span');
  el.textContent = String(str ?? '');
  return el.innerHTML;
}

// ============================================================
// LOGIKA ANTRIAN
// ============================================================

/**
 * Hitung estimasi waktu dipanggil berdasarkan nomor antrian.
 * @param {string} dateStr  – YYYY-MM-DD
 * @param {number} num      – nomor antrian (mulai dari 1)
 * @returns {string|null}   – "HH:MM" atau null jika tutup
 */
function calcEstTime(dateStr, num) {
  const sched = DOCTOR_SCHEDULE[getDow(dateStr)];
  if (!sched) return null;
  return addMinutes(sched.startTime, (num - 1) * AVG_MINUTES);
}

/** Hasilkan ID booking: PDN-YYYYMMDD-NNN */
function genBookingId(dateStr, num) {
  return `PDN-${dateStr.replace(/-/g, '')}-${String(num).padStart(3, '0')}`;
}

/**
 * Daftarkan antrian baru.
 * @returns {{ success: boolean, booking?: object, message?: string }}
 */
function bookQueue(data) {
  const { name, nik, phone, date, complaint } = data;
  const sched = DOCTOR_SCHEDULE[getDow(date)];

  if (!sched) {
    return { success: false, message: 'Poli tidak buka pada hari Minggu.' };
  }

  const today = todayStr();
  if (date < today) {
    return { success: false, message: 'Tidak dapat mendaftar untuk tanggal yang sudah lewat.' };
  }
  if (date > addDays(today, MAX_AHEAD_DAYS)) {
    return { success: false, message: `Pendaftaran hanya tersedia hingga ${MAX_AHEAD_DAYS} hari ke depan.` };
  }

  const existing = getActiveQueuesByDate(date);
  if (existing.length >= sched.maxQueue) {
    return { success: false, message: `Kuota antrian untuk tanggal ${formatDate(date)} sudah penuh (${sched.maxQueue} pasien).` };
  }

  // Cegah pendaftaran ganda (NIK yang sama, tanggal yang sama)
  if (existing.some(q => q.nik === nik)) {
    const dup = existing.find(q => q.nik === nik);
    return { success: false, message: `NIK ini sudah terdaftar di antrian nomor ${dup.queueNumber} untuk tanggal tersebut.` };
  }

  const num          = existing.length + 1;
  const estTime      = calcEstTime(date, num);
  const recArrival   = addMinutes(estTime, -ARRIVE_EARLY);
  const bookingId    = genBookingId(date, num);

  const entry = {
    id: bookingId,
    name: name.trim(),
    nik: nik.trim(),
    phone: phone.trim(),
    date,
    complaint: complaint.trim(),
    queueNumber: num,
    estimatedTime: estTime,
    recommendedArrival: recArrival,
    doctorArrival: sched.arrivalTime,
    doctorName: sched.doctor,
    bookedAt: new Date().toISOString(),
    status: 'waiting',
  };

  const all = getQueues();
  all.push(entry);
  saveQueues(all);

  return { success: true, booking: entry };
}

/**
 * Cari booking berdasarkan ID, NIK, atau nomor HP.
 * @param {string} term
 * @returns {object|null}
 */
function findBooking(term) {
  const t = term.trim();
  if (!t) return null;
  return getQueues().find(q =>
    q.id.toLowerCase() === t.toLowerCase() ||
    q.nik   === t ||
    q.phone === t
  ) || null;
}

/** Batalkan antrian berdasarkan ID. */
function cancelBooking(id) {
  const all = getQueues();
  const idx = all.findIndex(q => q.id === id);
  if (idx === -1) return false;
  all[idx].status = 'cancelled';
  saveQueues(all);
  return true;
}

// ============================================================
// UI – NAVIGASI
// ============================================================

function navigate(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + viewId).classList.add('active');
  document.querySelector('[data-view="' + viewId + '"]').classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (viewId === 'home')     refreshHome();
  if (viewId === 'check')    refreshCheckView();
  if (viewId === 'schedule') renderSchedule();
}

// ============================================================
// UI – BERANDA
// ============================================================

function refreshHome() {
  const today  = todayStr();
  const dow    = getDow(today);
  const sched  = DOCTOR_SCHEDULE[dow];
  const queues = getActiveQueuesByDate(today);

  // Tanggal di header
  const now = new Date();
  document.getElementById('headerDate').innerHTML =
    `${DAYS_ID[now.getDay()]}, ${now.getDate()} ${MONTHS_ID[now.getMonth()]} ${now.getFullYear()}<br>` +
    `${pad(now.getHours())}:${pad(now.getMinutes())} WIB`;

  document.getElementById('todayDate').textContent =
    `${DAYS_ID[dow]}, ${formatDate(today)}`;

  if (!sched) {
    document.getElementById('todayStatus').textContent      = 'TUTUP';
    document.getElementById('remainingQueue').textContent   = '0';
    document.getElementById('maxQueueToday').textContent    = '0';
    document.getElementById('doctorArrivalHome').textContent = '–';
    document.getElementById('doctorNameHome').textContent   = 'Tidak ada jadwal (Hari Minggu)';
    document.getElementById('registeredQueue').textContent  = '0';
    document.getElementById('queueTimeline').innerHTML      =
      '<p class="empty-msg">Poli tidak membuka layanan pada hari Minggu.</p>';
    return;
  }

  const remaining = sched.maxQueue - queues.length;
  document.getElementById('todayStatus').textContent      = remaining > 0 ? 'BUKA' : 'PENUH';
  document.getElementById('remainingQueue').textContent   = remaining;
  document.getElementById('maxQueueToday').textContent    = sched.maxQueue;
  document.getElementById('doctorArrivalHome').textContent = sched.arrivalTime;
  document.getElementById('doctorNameHome').textContent   = sched.doctor;
  document.getElementById('registeredQueue').textContent  = queues.length;

  renderTimeline(today, queues, sched);
}

function renderTimeline(dateStr, queues, sched) {
  const container = document.getElementById('queueTimeline');
  const show = Math.min(Math.max(queues.length + 5, 10), sched.maxQueue);
  const slots = [];

  for (let i = 1; i <= show; i++) {
    const est   = calcEstTime(dateStr, i);
    const taken = queues.find(q => q.queueNumber === i);
    const cls   = taken ? 'slot-taken' : 'slot-available';
    const lbl   = taken ? '✓ Terisi'   : 'Tersedia';
    slots.push(
      `<div class="queue-slot ${cls}">` +
        `<span class="slot-num">${pad(i)}</span>` +
        `<span class="slot-time">${est}</span>` +
        `<span class="slot-label">${escHtml(lbl)}</span>` +
      `</div>`
    );
  }

  if (queues.length < sched.maxQueue) {
    slots.push(
      `<div class="queue-slot slot-more">` +
        `<span class="slot-num">+${sched.maxQueue - queues.length}</span>` +
        `<span class="slot-label">kuota tersisa</span>` +
      `</div>`
    );
  }

  container.innerHTML = slots.join('');
}

// ============================================================
// UI – FORM PENDAFTARAN
// ============================================================

function initBookingForm() {
  const today   = todayStr();
  const maxDate = addDays(today, MAX_AHEAD_DAYS);
  const input   = document.getElementById('inputDate');
  input.min   = today;
  input.max   = maxDate;
  input.value = today;
  updateDatePreview();
  input.addEventListener('change', updateDatePreview);
}

function updateDatePreview() {
  const dateVal = document.getElementById('inputDate').value;
  const hint    = document.getElementById('dateHint');
  const preview = document.getElementById('bookingPreview');

  if (!dateVal) { preview.style.display = 'none'; return; }

  const dow   = getDow(dateVal);
  const sched = DOCTOR_SCHEDULE[dow];

  if (!sched) {
    hint.textContent  = 'Poli tidak buka pada hari Minggu.';
    hint.style.color  = 'var(--danger)';
    preview.style.display = 'none';
    return;
  }

  const queues    = getActiveQueuesByDate(dateVal);
  const remaining = sched.maxQueue - queues.length;

  if (remaining <= 0) {
    hint.textContent = `Antrian penuh untuk tanggal ini (${sched.maxQueue} pasien). Silakan pilih tanggal lain.`;
    hint.style.color = 'var(--danger)';
    preview.style.display = 'none';
    return;
  }

  hint.textContent = `${DAYS_ID[dow]}, ${formatDate(dateVal)}`;
  hint.style.color = 'var(--text-sub)';

  const nextNum = queues.length + 1;
  const estTime = calcEstTime(dateVal, nextNum);
  const recArr  = addMinutes(estTime, -ARRIVE_EARLY);

  preview.style.display = 'block';
  preview.innerHTML =
    `Sisa kuota: <strong>${remaining} dari ${sched.maxQueue}</strong> &nbsp;|&nbsp; ` +
    `Nomor antrian Anda: <strong>${nextNum}</strong> &nbsp;|&nbsp; ` +
    `Dokter tiba: <strong>${sched.arrivalTime}</strong> &nbsp;|&nbsp; ` +
    `Estimasi dipanggil: <strong>${estTime}</strong> &nbsp;|&nbsp; ` +
    `Disarankan tiba: <strong>${recArr}</strong>`;
}

function handleBookingSubmit(event) {
  event.preventDefault();
  const errorEl = document.getElementById('bookingError');
  errorEl.style.display = 'none';

  const name      = document.getElementById('inputName').value.trim();
  const nik       = document.getElementById('inputNik').value.trim();
  const phone     = document.getElementById('inputPhone').value.trim();
  const date      = document.getElementById('inputDate').value;
  const complaint = document.getElementById('inputComplaint').value.trim();

  // Validasi input
  if (!name) {
    return showBookingError('Nama lengkap wajib diisi.');
  }
  if (!/^\d{16}$/.test(nik)) {
    return showBookingError('NIK harus terdiri dari tepat 16 digit angka.');
  }
  if (!/^0\d{8,13}$/.test(phone)) {
    return showBookingError('Nomor HP tidak valid. Format: 08xxxxxxxxxx (10–14 digit).');
  }
  if (!date) {
    return showBookingError('Pilih tanggal kunjungan terlebih dahulu.');
  }

  const result = bookQueue({ name, nik, phone, date, complaint });

  if (!result.success) {
    return showBookingError(result.message);
  }

  showBookingModal(result.booking);
  event.target.reset();
  initBookingForm();
}

function showBookingError(msg) {
  const el = document.getElementById('bookingError');
  el.textContent    = msg;
  el.style.display  = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============================================================
// UI – MODAL KONFIRMASI
// ============================================================

function showBookingModal(booking) {
  const body = document.getElementById('modalBody');

  body.innerHTML =
    `<div class="booking-num">` +
      `<div class="booking-num-value">${String(booking.queueNumber).padStart(3, '0')}</div>` +
      `<div class="booking-num-label">Nomor Antrian Anda</div>` +
    `</div>` +

    `<div class="detail-grid">` +
      `<div class="detail-item"><label>ID Booking</label>` +
        `<span style="font-family:monospace;color:var(--primary);">${escHtml(booking.id)}</span></div>` +
      `<div class="detail-item"><label>Nama</label><span>${escHtml(booking.name)}</span></div>` +
      `<div class="detail-item"><label>Tanggal Kunjungan</label><span>${escHtml(formatDate(booking.date))}</span></div>` +
      `<div class="detail-item"><label>Dokter</label><span>${escHtml(booking.doctorName)}</span></div>` +
      `<div class="detail-item"><label>Dokter Tiba Pukul</label>` +
        `<span class="time-highlight">⏰ ${escHtml(booking.doctorArrival)}</span></div>` +
      `<div class="detail-item"><label>Estimasi Dipanggil</label>` +
        `<span class="time-highlight">⏰ ${escHtml(booking.estimatedTime)}</span></div>` +
    `</div>` +

    `<div class="arrival-box">` +
      `⚠️ Disarankan tiba pukul <strong>${escHtml(booking.recommendedArrival)}</strong> ` +
      `(${ARRIVE_EARLY} menit lebih awal dari estimasi).<br>` +
      `Simpan ID Booking Anda: <strong style="font-family:monospace;">${escHtml(booking.id)}</strong>` +
    `</div>`;

  buildPrintTicket(booking);
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

// ============================================================
// UI – CEK ANTRIAN
// ============================================================

function refreshCheckView() {
  renderTodayQueueList();
  document.getElementById('searchResult').innerHTML = '';
}

function handleSearch() {
  const term     = document.getElementById('searchInput').value.trim();
  const resultEl = document.getElementById('searchResult');

  if (!term) {
    resultEl.innerHTML = '<div class="alert alert-warning" style="margin-top:14px;">Masukkan ID Booking, NIK, atau Nomor HP.</div>';
    return;
  }

  const booking = findBooking(term);
  if (!booking) {
    resultEl.innerHTML =
      '<div class="alert alert-error" style="margin-top:14px;">' +
      'Antrian tidak ditemukan. Periksa kembali ID Booking, NIK, atau Nomor HP Anda.' +
      '</div>';
    return;
  }

  resultEl.innerHTML = buildQueueCard(booking);
}

function buildQueueCard(b) {
  const statusLabel = { waiting: 'Menunggu', called: 'Dipanggil', done: 'Selesai', cancelled: 'Dibatalkan' };
  const statusClass = { waiting: 'badge-waiting', called: 'badge-called', done: 'badge-done', cancelled: 'badge-cancelled' };
  const isToday     = b.date === todayStr();

  const cancelBtn = (b.status === 'waiting')
    ? `<button class="btn btn-danger btn-sm" onclick="handleCancel('${escHtml(b.id)}')">Batalkan Antrian</button>`
    : '';

  return `
    <div class="queue-card">
      <div class="queue-card-header">
        <div>
          <div style="font-size:0.75rem;opacity:0.78;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Nomor Antrian</div>
          <div class="queue-card-number">${String(b.queueNumber).padStart(3, '0')}</div>
        </div>
        <div class="queue-card-header-right">
          <div class="badge ${statusClass[b.status] || 'badge-waiting'}">${escHtml(statusLabel[b.status] || b.status)}</div>
          <div style="font-size:0.8rem;opacity:0.85;margin-top:8px;font-family:monospace;">${escHtml(b.id)}</div>
        </div>
      </div>

      <div class="queue-card-body">
        <div class="detail-grid">
          <div class="detail-item">
            <label>Nama</label>
            <span>${escHtml(b.name)}</span>
          </div>
          <div class="detail-item">
            <label>Tanggal Kunjungan</label>
            <span>${escHtml(formatDate(b.date))}${isToday ? '<span class="today-tag">Hari ini</span>' : ''}</span>
          </div>
          <div class="detail-item">
            <label>Dokter</label>
            <span>${escHtml(b.doctorName)}</span>
          </div>
          <div class="detail-item">
            <label>Dokter Tiba Pukul</label>
            <span class="time-highlight">⏰ ${escHtml(b.doctorArrival)}</span>
          </div>
          <div class="detail-item">
            <label>Estimasi Dipanggil</label>
            <span class="time-highlight">⏰ ${escHtml(b.estimatedTime)}</span>
          </div>
          <div class="detail-item">
            <label>Disarankan Tiba</label>
            <span class="time-arrive">⏰ ${escHtml(b.recommendedArrival)}</span>
          </div>
          ${b.complaint ? `<div class="detail-item" style="grid-column:1/-1;"><label>Keluhan</label><span>${escHtml(b.complaint)}</span></div>` : ''}
        </div>

        <div class="card-actions">
          ${cancelBtn}
          <span style="font-size:0.78rem;color:var(--text-sub);">Didaftarkan: ${escHtml(formatDateTime(b.bookedAt))}</span>
        </div>
      </div>
    </div>`;
}

function handleCancel(id) {
  if (!confirm('Apakah Anda yakin ingin membatalkan antrian ini?')) return;
  if (cancelBooking(id)) {
    document.getElementById('searchResult').innerHTML =
      '<div class="alert alert-success" style="margin-top:14px;">Antrian berhasil dibatalkan.</div>';
    renderTodayQueueList();
    if (document.getElementById('view-home').classList.contains('active')) refreshHome();
  }
}

function renderTodayQueueList() {
  const today   = todayStr();
  const queues  = getActiveQueuesByDate(today);
  const el      = document.getElementById('todayQueueList');

  if (queues.length === 0) {
    el.innerHTML = '<div class="empty-msg">Belum ada antrian terdaftar untuk hari ini.</div>';
    return;
  }

  const rows = queues.map(q =>
    `<tr>
      <td><strong>${String(q.queueNumber).padStart(3, '0')}</strong></td>
      <td>${escHtml(q.name)}</td>
      <td style="color:var(--primary);font-weight:600;">${escHtml(q.estimatedTime)}</td>
      <td style="color:var(--warning);font-weight:600;">${escHtml(q.recommendedArrival)}</td>
      <td><span class="badge badge-waiting">Menunggu</span></td>
    </tr>`
  ).join('');

  el.innerHTML =
    `<table class="today-queue-table">
      <thead>
        <tr>
          <th>No.</th>
          <th>Nama Pasien</th>
          <th>Est. Dipanggil</th>
          <th>Disarankan Tiba</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ============================================================
// UI – JADWAL DOKTER
// ============================================================

function renderSchedule() {
  const todayDow = getDow(todayStr());
  const tbody    = document.getElementById('scheduleTableBody');

  const rows = DAYS_ID.map((day, dow) => {
    const sched   = DOCTOR_SCHEDULE[dow];
    const isToday = dow === todayDow;
    const todayTag = isToday ? '<span class="today-tag">Hari ini</span>' : '';

    if (!sched) {
      return `<tr class="${isToday ? 'row-today' : 'row-closed'}">
        <td>${day}${todayTag}</td>
        <td colspan="5" style="color:var(--text-sub);">— Tutup —</td>
      </tr>`;
    }

    return `<tr class="${isToday ? 'row-today' : ''}">
      <td>${day}${todayTag}</td>
      <td>${escHtml(sched.doctor)}</td>
      <td><strong>${escHtml(sched.arrivalTime)}</strong></td>
      <td>${escHtml(sched.startTime)}</td>
      <td>${escHtml(sched.endTime)}</td>
      <td>${sched.maxQueue} pasien</td>
    </tr>`;
  });

  tbody.innerHTML = rows.join('');
}

// ============================================================
// CETAK TIKET
// ============================================================

function buildPrintTicket(b) {
  document.getElementById('printArea').innerHTML =
    `<div class="ticket">
      <div class="ticket-header">
        <div style="font-size:14pt;font-weight:bold;">RSUD SEJAHTERA</div>
        <div>Poli Penyakit Dalam</div>
        <div style="font-size:9pt;color:#555;">Jl. Kesehatan No. 1, Kota Sejahtera</div>
      </div>
      <div class="ticket-num">${String(b.queueNumber).padStart(3, '0')}</div>
      <div class="ticket-row"><span>ID Booking</span><span>${b.id}</span></div>
      <div class="ticket-row"><span>Nama</span><span>${b.name}</span></div>
      <div class="ticket-row"><span>Tanggal</span><span>${formatDate(b.date)}</span></div>
      <div class="ticket-row"><span>Dokter</span><span>${b.doctorName}</span></div>
      <div class="ticket-row"><span>Dokter Tiba</span><span>${b.doctorArrival}</span></div>
      <div class="ticket-row"><span>Est. Dipanggil</span><span>${b.estimatedTime}</span></div>
      <div class="ticket-row"><span>Tiba Paling Lambat</span><span>${b.recommendedArrival}</span></div>
      <div class="ticket-footer">Dicetak: ${formatDateTime(new Date().toISOString())}</div>
    </div>`;
}

function printTicket() {
  window.print();
}

// ============================================================
// INISIALISASI
// ============================================================

document.addEventListener('DOMContentLoaded', function () {
  // Navigasi antar tab
  document.querySelectorAll('.nav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      navigate(btn.dataset.view);
    });
  });

  // Siapkan form
  initBookingForm();

  // Tampilkan beranda
  refreshHome();

  // Render jadwal (diperlukan jika user langsung ke tab jadwal)
  renderSchedule();
});
