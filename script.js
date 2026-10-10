const STORAGE_PREFIX = "wing-state-";
const OLD_KEY = "wing-c3-state";   // بيانات النسخة القديمة (بتتنقل للدور التالت)
const ROOMS_PER_WING = 16;

// الأدوار وعدد الأجنحة في كل دور
const FLOORS = [
  { number: 1, wings: 2 },   // الدور الأول جناحين (اتشال الجناح التالت)
  { number: 2, wings: 3 },
  { number: 3, wings: 1 },   // الدور التالت جناح واحد بس
  { number: 4, wings: 3 },
];
const ORDINALS = ["الأول", "الثاني", "الثالث", "الرابع"];

class Room {
  constructor(number) {
    this.number = number;
    this.tasksDone = 0;
    this.skips = 0;
    this.lastSeq = 0;     // ترتيب آخر تعامل (تنفيذ/تخطي) عشان الدور يتحرك
    this.doneDates = [];  // تواريخ التسليم (ISO) بالترتيب
  }

  get lastDone() {
    return this.doneDates.length ? this.doneDates[this.doneDates.length - 1] : null;
  }
}

// تنسيق التاريخ بالعربي
function fmtDate(iso) {
  return new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
}
function lastDoneText(r) {
  return r.lastDone ? fmtDate(r.lastDone) : "لسه ما اتسلمتش";
}

class Wing {
  constructor(floor, index) {
    this.floor = floor;                 // رقم الدور
    this.index = index;                 // ترتيب الجناح جوه الدور (0,1,2)
    this.id = `f${floor}-w${index + 1}`;
    this.name = ORDINALS[index];
    this.seq = 0;
    this.rooms = [];
    const first = index * ROOMS_PER_WING + 1;   // 1 / 17 / 33
    const last = first + ROOMS_PER_WING - 1;    // 16 / 32 / 48
    for (let n = first; n <= last; n++) this.rooms.push(new Room(n));
  }

  get storageKey() { return STORAGE_PREFIX + this.id; }

  getRoom(number) {
    return this.rooms.find(r => r.number === number);
  }

  // ترتيب الدور: الأقل تنفيذاً، وبعدين اللي مخدش دور من فترة، وبعدين الرقم الأصغر
  sortedByTurn() {
    return [...this.rooms].sort((a, b) =>
      a.tasksDone - b.tasksDone || a.lastSeq - b.lastSeq || a.number - b.number
    );
  }

  leastDoneRooms() {
    const sorted = this.sortedByTurn();
    const min = sorted[0].tasksDone;
    // بنرتبهم بالرقم عشان الأوضة اللي اتخطت متختفيش ولا تتنقل في آخر السلايدر
    return sorted.filter(r => r.tasksDone === min).sort((a, b) => a.number - b.number);
  }

  currentTurn() { return this.sortedByTurn()[0]; }

  markDone(number) {
    const r = this.getRoom(number);
    r.tasksDone++;
    r.doneDates.push(new Date().toISOString());   // تاريخ ووقت التسليم
    r.lastSeq = ++this.seq;
  }

  skip(number) {
    const r = this.getRoom(number);
    r.skips++;
    r.lastSeq = ++this.seq;   // يروح آخر الطابور من غير ما العدد يزيد
  }

  save() {
    localStorage.setItem(this.storageKey, JSON.stringify({ seq: this.seq, rooms: this.rooms }));
  }

  load() {
    try {
      let raw = localStorage.getItem(this.storageKey);
      // نقل بيانات النسخة القديمة للدور التالت
      if (!raw && this.floor === 3 && this.index === 0) raw = localStorage.getItem(OLD_KEY);
      const data = JSON.parse(raw);
      if (!data) return;
      this.seq = data.seq;
      data.rooms.forEach(saved => {
        const r = this.getRoom(saved.number);
        if (r) Object.assign(r, saved);
      });
    } catch (e) { /* تجاهل أي بيانات تالفة */ }
  }
}

// ===== بناء الأجنحة =====
const wings = [];
FLOORS.forEach(f => {
  for (let i = 0; i < f.wings; i++) {
    const w = new Wing(f.number, i);
    w.load();
    wings.push(w);
  }
});
const wingById = id => wings.find(w => w.id === id);
const wingsOfFloor = n => wings.filter(w => w.floor === n);

const floorsEl = document.getElementById("floors");
const modal = new bootstrap.Modal(document.getElementById("roomModal"));
let open = null;   // { wingId, number }

// ===== هيكل الصفحة: كارد لكل دور، وجواه كارد لكل جناح =====
function buildLayout() {
  floorsEl.innerHTML = FLOORS.map((f, fi) => {
    const wingCards = wingsOfFloor(f.number).map(w => `
      <div class="card wing-card border-0 shadow-sm">
        <div class="card-header wing-header">
          <i class="fa-solid fa-building-user"></i> الجناح ${w.name}
          <span class="wing-range">الأوض ${w.rooms[0].number} – ${w.rooms[w.rooms.length - 1].number}</span>
        </div>
        <div class="card-body">
          <h3 class="h6 mb-3"><i class="fa-solid fa-bell"></i> عليهم الدور</h3>
          <div id="carousel-${w.id}" class="carousel slide turn-carousel mb-4" data-bs-ride="false">
            <div class="carousel-inner" id="inner-${w.id}"></div>
            <button class="carousel-control-prev" type="button" data-bs-target="#carousel-${w.id}" data-bs-slide="prev">
              <span class="carousel-control-prev-icon"></span>
            </button>
            <button class="carousel-control-next" type="button" data-bs-target="#carousel-${w.id}" data-bs-slide="next">
              <span class="carousel-control-next-icon"></span>
            </button>
          </div>
          <h3 class="h6 mb-3"><i class="fa-solid fa-door-open"></i> باقي الأوض</h3>
          <div class="row g-3" id="grid-${w.id}"></div>
        </div>
      </div>`).join("");

    const wingsLabel = f.wings === 1 ? "جناح واحد" : `${f.wings} أجنحة`;
    const roomsCount = f.wings * ROOMS_PER_WING;

    return `
      <section class="card floor-card border-0 shadow">
        <button class="floor-header ${fi === 0 ? "" : "collapsed"}" type="button"
                data-bs-toggle="collapse" data-bs-target="#floor-${f.number}"
                aria-expanded="${fi === 0}">
          <span><i class="fa-solid fa-layer-group"></i> الدور ${ORDINALS[f.number - 1]}</span>
          <span class="floor-meta">${wingsLabel} · ${roomsCount} أوضة <i class="fa-solid fa-chevron-down chev"></i></span>
        </button>
        <div id="floor-${f.number}" class="collapse ${fi === 0 ? "show" : ""}">
          <div class="floor-body d-flex flex-column gap-3">${wingCards}</div>
        </div>
      </section>`;
  }).join("");
}

// ===== رسم جناح واحد =====
function renderWing(w) {
  const slideRooms = w.leastDoneRooms();
  const turn = w.currentTurn();

  document.getElementById(`inner-${w.id}`).innerHTML = slideRooms.map(r => `
    <div class="carousel-item ${r === turn ? "active" : ""}">
      <div class="turn-slide">
        <span class="turn-badge ${r === turn ? "" : "waiting"}">
          ${r === turn ? '<i class="fa-solid fa-star"></i> عليها الدور' : "في الانتظار"}
        </span>
        <div class="turn-number my-3">${r.number}</div>
        <p class="text-muted mb-3">
          الدور ${ORDINALS[w.floor - 1]} · الجناح ${w.name} · نفّذت ${r.tasksDone} مرة
          · تخطّت ${r.skips} مرة
        </p>
        <p class="last-done mb-3"><i class="fa-regular fa-calendar-check"></i> آخر تسليم: <strong>${lastDoneText(r)}</strong></p>
        <div class="d-flex justify-content-center gap-2 flex-wrap">
          <button class="btn btn-success" data-action="done" data-wing="${w.id}" data-room="${r.number}">
            <i class="fa-solid fa-check"></i> نفّذ التاسك
          </button>
          <button class="btn btn-outline-danger" data-action="skip" data-wing="${w.id}" data-room="${r.number}">
            <i class="fa-solid fa-xmark"></i> مش هينفذ المرة دي
          </button>
        </div>
      </div>
    </div>`).join("");

  const inSlider = new Set(slideRooms.map(r => r.number));
  const others = w.rooms.filter(r => !inSlider.has(r.number)).sort((a, b) => a.number - b.number);

  document.getElementById(`grid-${w.id}`).innerHTML = others.length
    ? others.map(r => `
      <div class="col-6 col-md-4 col-lg-3">
        <div class="card room-card h-100 shadow-sm" tabindex="0" role="button"
             data-wing="${w.id}" data-room="${r.number}">
          <div class="card-body">
            <div class="num">${r.number}</div>
            <div class="text-muted small">الدور ${ORDINALS[w.floor - 1]} · جناح ${w.name}</div>
            <div class="mt-2"><i class="fa-solid fa-list-check text-success"></i> نفّذت ${r.tasksDone} مرة</div>
            <div class="small text-muted mt-1"><i class="fa-regular fa-calendar-check"></i> ${lastDoneText(r)}</div>
          </div>
        </div>
      </div>`).join("")
    : '<p class="text-muted">كل الأوض في السلايدر حالياً.</p>';

  w.save();
  if (open && open.wingId === w.id) fillModal();
}

function fillModal() {
  const w = wingById(open.wingId);
  const r = w.getRoom(open.number);
  const isTurn = w.currentTurn() === r;
  document.getElementById("mRoom").textContent = r.number;
  document.getElementById("mFloor").textContent = ORDINALS[w.floor - 1];
  document.getElementById("mWing").textContent = w.name;
  document.getElementById("mNumber").textContent = r.number;
  document.getElementById("mCount").textContent = r.tasksDone;
  document.getElementById("mSkips").textContent = r.skips;
  document.getElementById("mLastDone").textContent = lastDoneText(r);
  document.getElementById("mHistory").innerHTML = r.doneDates.length
    ? [...r.doneDates].reverse().map(d => `<li class="list-group-item py-1">${fmtDate(d)}</li>`).join("")
    : '<li class="list-group-item py-1 text-muted">لسه مفيش تسليمات</li>';
  document.getElementById("mStatus").textContent = isTurn ? "عليها الدور" : "مش عليها الدور";
}

// ===== الأحداث =====
// أزرار السلايدر
floorsEl.addEventListener("click", e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const w = wingById(btn.dataset.wing);
  const number = Number(btn.dataset.room);
  btn.dataset.action === "done" ? w.markDone(number) : w.skip(number);
  renderWing(w);
});

// فتح المودل من كارت الأوضة
function openFromCard(e) {
  const card = e.target.closest(".room-card");
  if (!card) return;
  open = { wingId: card.dataset.wing, number: Number(card.dataset.room) };
  fillModal();
  modal.show();
}
floorsEl.addEventListener("click", openFromCard);
floorsEl.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") {
    if (e.target.closest(".room-card")) { e.preventDefault(); openFromCard(e); }
  }
});

document.getElementById("mDoneBtn").addEventListener("click", () => {
  const w = wingById(open.wingId);
  w.markDone(open.number);
  renderWing(w);
});

document.getElementById("roomModal").addEventListener("hidden.bs.modal", () => { open = null; });

document.getElementById("resetBtn").addEventListener("click", () => {
  if (!confirm("متأكد إنك عايز تصفّر كل العدادات في كل الأدوار؟")) return;
  Object.keys(localStorage).filter(k => k.startsWith(STORAGE_PREFIX)).forEach(k => localStorage.removeItem(k));
  localStorage.removeItem(OLD_KEY);
  location.reload();
});

buildLayout();
wings.forEach(renderWing);
