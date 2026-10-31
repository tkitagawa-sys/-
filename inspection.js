const { useState, useEffect } = React;

const STORAGE_KEY = "vehicle-inspection-v1";
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const CONTENT_PRESETS = ["3ヶ月", "車検", "ﾕﾆｯｸ", "クレーン点検", "新車1年点検", "年次検査", "セルフ点検"];
const SHOP_PRESETS = ["三愛自動車", "日野自動車", "いすゞ", "中田自動車", "富山地鉄", "北陸車検", "トヨタ"];
const EXPIRY_WARN_DAYS = 45;

const FONT = "'Noto Sans JP', sans-serif";
const MONO = "'DM Mono', monospace";
const C = {
  bg: "#13151a", panel: "#1a1d24", input: "#1e2128", line: "#2a2d35",
  text: "#e8eaf0", sub: "#8a8f98", dim: "#555",
  done: "#4ade80", overdue: "#ff6b6b", now: "#f59e0b", plan: "#8a8f98", shaken: "#2a6ef5",
};

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const p2 = (n) => String(n).padStart(2, "0");

/* ---------- 保存まわり（端末内 localStorage） ---------- */

function cloneSeed() {
  return JSON.parse(JSON.stringify(window.INSPECTION_SEED || { teams: [], vehicles: [] }));
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.teams) && Array.isArray(d.vehicles)) return d;
    }
  } catch (e) { /* 壊れていたら初期データに戻す */ }
  return cloneSeed();
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* ---------- 日付・状態判定 ---------- */

function formatDate(s) {
  if (!s) return "";
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s);
  return m ? `${Number(m[2])}/${Number(m[3])}` : s;
}

function formatFullDate(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || "");
  return m ? `${m[1]}/${m[2]}/${m[3]}` : (s || "—");
}

function daysUntil(iso) {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || "");
  if (!m) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(+m[1], +m[2] - 1, +m[3]) - today) / 86400000);
}

// done=実施済み / overdue=月が過ぎたのに未実施 / now=今月予定 / plan=先の予定
function itemStatus(item) {
  if (item.done) return "done";
  const now = new Date();
  const ym = now.getFullYear() * 12 + now.getMonth() + 1;
  const target = item.year * 12 + item.month;
  if (target < ym) return "overdue";
  if (target === ym) return "now";
  return "plan";
}

const STATUS_LABEL = { done: "実施済", overdue: "未実施", now: "今月", plan: "予定" };

function expiryInfo(v) {
  const d = daysUntil(v.expiry);
  if (d === null || v.sold) return null;
  if (d > EXPIRY_WARN_DAYS) return null;
  // 期限の約3ヶ月前以降に車検を実施済みなら、期限日の更新漏れとして扱う
  const renewed = v.items.some(i => i.done && i.content.includes("車検") &&
    (i.year * 12 + i.month) >= (Number(v.expiry.slice(0, 4)) * 12 + Number(v.expiry.slice(5, 7)) - 3));
  if (renewed) return { color: C.now, text: "車検済・期限日を更新", renewed: true };
  if (d < 0) return { color: C.overdue, text: `期限切れ ${-d}日` };
  if (d <= EXPIRY_WARN_DAYS) return { color: C.now, text: `あと${d}日` };
  return null;
}

// 車検月を基準に、3ヶ月点検を3・6・9ヶ月ずらしで配置
function autoSchedule(expiry, year) {
  const m = /^(\d{4})-(\d\d)/.exec(expiry || "");
  if (!m) return [];
  const sm = Number(m[2]);
  const items = [{ id: newId(), year, month: sm, content: "車検", date: "", shop: "", done: false }];
  [3, 6, 9].forEach(off => {
    items.push({ id: newId(), year, month: ((sm - 1 + off) % 12) + 1, content: "3ヶ月", date: "", shop: "", done: false });
  });
  return items.sort((a, b) => a.month - b.month);
}

/* ---------- CSV出力 ---------- */

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
}

function downloadCSV(data, year) {
  const esc = (val) => {
    const s = val === undefined || val === null ? "" : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["チーム", "車番", "担当者", "車検有効期限", "年", "月", "内容", "実施日", "業者・請求書", "状態"];
  const rows = [];
  data.teams.forEach(t => {
    data.vehicles.filter(v => v.teamId === t.id).forEach(v => {
      const items = v.items.filter(i => i.year === year).sort((a, b) => a.month - b.month);
      if (items.length === 0) rows.push([t.name, v.plate, v.driver, v.expiry, year, "", "", "", "", v.sold ? "売却" : ""]);
      items.forEach(i => rows.push([t.name, v.plate, v.driver, v.expiry, i.year, i.month, i.content, i.date, i.shop, STATUS_LABEL[itemStatus(i)]]));
    });
  });
  const csv = [header, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
  // BOM付きUTF-8 → Excelで開いても文字化けしない
  downloadBlob("﻿" + csv, `車輌点検一覧_${year}年_${todayStamp()}.csv`, "text/csv;charset=utf-8;");
}

/* ---------- UI部品 ---------- */

const inputStyle = {
  width: "100%", background: C.input, color: C.text, border: `1px solid ${C.line}`,
  borderRadius: 8, padding: "10px", fontSize: 14, fontFamily: FONT,
};

const btn = (bg, color = "#fff") => ({
  padding: "10px 14px", borderRadius: 8, border: "none", background: bg, color,
  fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
});

const ghostBtn = {
  padding: "10px 14px", borderRadius: 8, border: `1px solid #3a3d45`, background: "transparent",
  color: C.sub, fontSize: 12, cursor: "pointer", fontFamily: FONT,
};

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "#000a", zIndex: 50,
      display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "40px 12px", overflowY: "auto",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 480, background: C.panel, border: `1px solid ${C.line}`,
        borderRadius: 16, padding: 22, fontFamily: FONT,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, whiteSpace: "pre-line" }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.sub, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Chip({ item }) {
  const st = itemStatus(item);
  const color = C[st];
  const isShaken = item.content.includes("車検");
  return (
    <div style={{
      borderLeft: `3px solid ${isShaken ? C.shaken : color}`, background: `${color}14`,
      borderRadius: 4, padding: "3px 5px", marginBottom: 3, textAlign: "left",
    }}>
      <div style={{ fontSize: 11, color: C.text, fontWeight: isShaken ? 700 : 400, whiteSpace: "pre-line", lineHeight: 1.35, wordBreak: "break-all" }}>
        {st === "done" ? "✓ " : ""}{item.content || "（内容なし）"}
      </div>
      {(item.date || item.shop) && (
        <div style={{ fontSize: 10, color: C.sub, marginTop: 1, lineHeight: 1.3, wordBreak: "break-all" }}>
          {formatDate(item.date)}{item.date && item.shop ? " " : ""}{item.shop}
        </div>
      )}
    </div>
  );
}

/* ---------- 点検の編集（車輌×月） ---------- */

function ItemEditor({ vehicle, year, month, onSave, onClose }) {
  const [items, setItems] = useState(
    vehicle.items.filter(i => i.year === year && i.month === month).map(i => ({ ...i }))
  );

  const update = (id, patch) => setItems(items.map(i => (i.id === id ? { ...i, ...patch } : i)));
  const add = (content = "") => setItems([...items, { id: newId(), year, month, content, date: "", shop: "", done: false }]);
  const remove = (id) => setItems(items.filter(i => i.id !== id));

  const handleSave = () => {
    const others = vehicle.items.filter(i => !(i.year === year && i.month === month));
    const cleaned = items
      .filter(i => i.content.trim() || i.date.trim() || i.shop.trim())
      .map(i => ({ ...i, content: i.content.trim(), date: i.date.trim(), shop: i.shop.trim() }));
    onSave({ ...vehicle, items: [...others, ...cleaned] });
  };

  return (
    <Modal title={`${vehicle.plate}（${vehicle.driver || "担当未設定"}）\n${year}年${month}月の点検`} onClose={onClose}>
      <datalist id="content-presets">{CONTENT_PRESETS.map(c => <option key={c} value={c} />)}</datalist>
      <datalist id="shop-presets">{SHOP_PRESETS.map(c => <option key={c} value={c} />)}</datalist>

      {items.length === 0 && <div style={{ fontSize: 13, color: C.sub, marginBottom: 14 }}>この月の予定はまだありません</div>}

      {items.map(i => (
        <div key={i.id} style={{ background: C.bg, borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <Field label="内容">
            <textarea list="content-presets" value={i.content} rows={i.content.includes("\n") ? 3 : 1}
              onChange={e => update(i.id, { content: e.target.value })}
              style={{ ...inputStyle, resize: "vertical" }} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {CONTENT_PRESETS.map(c => (
                <button key={c} onClick={e => { e.preventDefault(); update(i.id, { content: c }); }} style={{
                  padding: "4px 8px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: FONT,
                  border: `1px solid ${i.content === c ? C.shaken : C.line}`,
                  background: i.content === c ? `${C.shaken}33` : "transparent", color: C.sub,
                }}>{c}</button>
              ))}
            </div>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="実施日">
              <input type="date" value={/^\d{4}-\d\d-\d\d$/.test(i.date) ? i.date : ""}
                onChange={e => update(i.id, { date: e.target.value, done: e.target.value ? true : i.done })}
                style={inputStyle} />
              {i.date && !/^\d{4}-\d\d-\d\d$/.test(i.date) && (
                <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>記録：{i.date}</div>
              )}
            </Field>
            <Field label="業者・請求書">
              <input list="shop-presets" value={i.shop} onChange={e => update(i.id, { shop: e.target.value })} style={inputStyle} />
            </Field>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: i.done ? C.done : C.sub, cursor: "pointer" }}>
              <input type="checkbox" checked={i.done} onChange={e => update(i.id, { done: e.target.checked })} style={{ width: 18, height: 18 }} />
              実施済み
            </label>
            <button onClick={() => remove(i.id)} style={{ background: "none", border: "none", color: C.dim, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>この点検を削除</button>
          </div>
        </div>
      ))}

      <button onClick={() => add()} style={{ ...ghostBtn, width: "100%", marginBottom: 16 }}>＋ 点検を追加</button>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClose} style={{ ...ghostBtn, flex: 1 }}>キャンセル</button>
        <button onClick={handleSave} style={{ ...btn("#2a6ef5"), flex: 2 }}>保存</button>
      </div>
    </Modal>
  );
}

/* ---------- 車輌の追加・編集 ---------- */

function VehicleEditor({ vehicle, teams, year, onSave, onDelete, onClose }) {
  const isNew = !vehicle.id;
  const [v, setV] = useState({ ...vehicle });
  const [auto, setAuto] = useState(isNew);
  const set = (patch) => setV({ ...v, ...patch });

  const handleSave = () => {
    if (!v.plate.trim()) { alert("車番を入力してください"); return; }
    let items = v.items || [];
    if (isNew && auto) items = autoSchedule(v.expiry, year);
    onSave({ ...v, id: v.id || newId(), plate: v.plate.trim(), driver: v.driver.trim(), items });
  };

  return (
    <Modal title={isNew ? "車輌を追加" : "車輌情報の編集"} onClose={onClose}>
      <Field label="車番">
        <input value={v.plate} onChange={e => set({ plate: e.target.value })} placeholder="富山 130 あ 1234" style={inputStyle} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="担当者">
          <input value={v.driver} onChange={e => set({ driver: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="チーム">
          <select value={v.teamId} onChange={e => set({ teamId: e.target.value })} style={inputStyle}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="車検有効期限">
        <input type="date" value={v.expiry} onChange={e => set({ expiry: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="メモ">
        <textarea value={v.memo} rows={2} onChange={e => set({ memo: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} />
      </Field>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.sub, marginBottom: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={v.sold} onChange={e => set({ sold: e.target.checked })} style={{ width: 18, height: 18 }} />
        売却済み（一覧でグレー表示）
      </label>
      {isNew && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.sub, marginBottom: 18, cursor: "pointer" }}>
          <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} style={{ width: 18, height: 18 }} />
          車検月から{year}年の予定（車検＋3ヶ月点検×3）を自動作成
        </label>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        {!isNew && (
          <button onClick={() => onDelete(v.id)} style={{ ...ghostBtn, color: C.overdue, borderColor: `${C.overdue}66` }}>削除</button>
        )}
        <button onClick={onClose} style={{ ...ghostBtn, flex: 1 }}>キャンセル</button>
        <button onClick={handleSave} style={{ ...btn("#2a6ef5"), flex: 2 }}>保存</button>
      </div>
    </Modal>
  );
}

/* ---------- サマリー ---------- */

function SummaryCards({ vehicles, year }) {
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  const active = vehicles.filter(v => !v.sold);
  const items = active.flatMap(v => v.items.filter(i => i.year === year).map(i => ({ ...i, v })));
  const monthItems = year === thisYear ? items.filter(i => i.month === thisMonth) : [];
  const overdue = items.filter(i => itemStatus(i) === "overdue");
  const expiring = active.filter(v => { const e = expiryInfo(v); return e && !e.renewed; });
  const needUpdate = active.filter(v => { const e = expiryInfo(v); return e && e.renewed; });

  const Card = ({ label, value, color, sub }) => (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 11, color: C.dim, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: MONO }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.sub, marginTop: 4 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
      <Card label="登録車輌" value={active.length} color={C.text} sub={`売却済み ${vehicles.length - active.length}台`} />
      <Card label={year === thisYear ? `今月（${thisMonth}月）の点検` : "今月の点検"} value={monthItems.length} color={C.now}
        sub={year === thisYear ? `うち実施済み ${monthItems.filter(i => i.done).length}件` : `${year}年を表示中`} />
      <Card label="過ぎた月の未実施" value={overdue.length} color={overdue.length ? C.overdue : C.done} sub="実施日の入力漏れも含む" />
      <Card label={`車検期限 ${EXPIRY_WARN_DAYS}日以内・切れ`} value={expiring.length} color={expiring.length ? C.overdue : C.done} sub={`車検済で期限日の更新待ち ${needUpdate.length}台`} />
    </div>
  );
}

/* ---------- 一覧表 ---------- */

function InspectionTable({ vehicles, year, onCell, onVehicle }) {
  const now = new Date();
  const curMonth = now.getFullYear() === year ? now.getMonth() + 1 : 0;
  const th = { padding: "8px 4px", fontSize: 11, color: C.dim, fontWeight: 400, borderBottom: `1px solid ${C.line}`, background: C.panel };

  if (vehicles.length === 0) {
    return <div style={{ fontSize: 13, color: C.sub, padding: 20 }}>このチームには車輌が登録されていません</div>;
  }

  return (
    <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 12 }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: 1180, width: "100%", fontFamily: FONT }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, zIndex: 2, minWidth: 150, paddingLeft: 12 }}>車番 / 担当 / 車検期限</th>
            {MONTHS.map(m => (
              <th key={m} style={{ ...th, minWidth: 82, color: m === curMonth ? C.now : C.dim, fontWeight: m === curMonth ? 700 : 400 }}>{m}月</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vehicles.map(v => {
            const exp = expiryInfo(v);
            return (
              <tr key={v.id} style={{ opacity: v.sold ? 0.45 : 1 }}>
                <td onClick={() => onVehicle(v)} style={{
                  position: "sticky", left: 0, zIndex: 1, background: C.panel, cursor: "pointer",
                  borderBottom: `1px solid ${C.line}`, borderRight: `1px solid ${C.line}`, padding: "8px 8px 8px 12px", verticalAlign: "top",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, whiteSpace: "nowrap" }}>{v.plate}</div>
                  <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{v.driver || "—"}{v.sold ? "（売却）" : ""}</div>
                  <div style={{ fontSize: 11, color: exp ? exp.color : C.dim, marginTop: 2, fontFamily: MONO }}>
                    {formatFullDate(v.expiry)}{exp ? ` ${exp.text}` : ""}
                  </div>
                  {v.memo && <div style={{ fontSize: 10, color: "#6a6f78", marginTop: 3, whiteSpace: "pre-line", maxWidth: 160 }}>📝 {v.memo}</div>}
                </td>
                {MONTHS.map(m => {
                  const items = v.items.filter(i => i.year === year && i.month === m);
                  return (
                    <td key={m} onClick={() => onCell(v, m)} style={{
                      borderBottom: `1px solid ${C.line}`, borderRight: `1px solid ${C.line}22`,
                      padding: 4, verticalAlign: "top", cursor: "pointer",
                      background: m === curMonth ? `${C.now}0d` : "transparent",
                    }}>
                      {items.map(i => <Chip key={i.id} item={i} />)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- メイン ---------- */

function App() {
  const [data, setData] = useState(loadData);
  const [teamId, setTeamId] = useState(() => (loadData().teams[0] || {}).id);
  const [year, setYear] = useState(new Date().getFullYear());
  const [cellEdit, setCellEdit] = useState(null);       // { vehicle, month }
  const [vehicleEdit, setVehicleEdit] = useState(null); // vehicle

  useEffect(() => { saveData(data); }, [data]);

  const team = data.teams.find(t => t.id === teamId) || data.teams[0];
  const vehicles = team ? data.vehicles.filter(v => v.teamId === team.id) : [];

  const saveVehicle = (v) => {
    const exists = data.vehicles.some(x => x.id === v.id);
    setData({ ...data, vehicles: exists ? data.vehicles.map(x => (x.id === v.id ? v : x)) : [...data.vehicles, v] });
    setCellEdit(null);
    setVehicleEdit(null);
  };

  const deleteVehicle = (id) => {
    if (!confirm("この車輌と点検記録をすべて削除します。よろしいですか？")) return;
    setData({ ...data, vehicles: data.vehicles.filter(v => v.id !== id) });
    setVehicleEdit(null);
  };

  const updateTeamNotes = (notes) => {
    setData({ ...data, teams: data.teams.map(t => (t.id === team.id ? { ...t, notes } : t)) });
  };

  const addTeam = () => {
    const name = prompt("追加するチーム名");
    if (!name || !name.trim()) return;
    const t = { id: newId(), name: name.trim(), checker: "", notes: "" };
    setData({ ...data, teams: [...data.teams, t] });
    setTeamId(t.id);
  };

  const exportJSON = () => {
    downloadBlob(JSON.stringify(data, null, 1), `車輌点検_バックアップ_${todayStamp()}.json`, "application/json");
  };

  const importJSON = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!Array.isArray(d.teams) || !Array.isArray(d.vehicles)) throw new Error();
        if (!confirm("現在のデータをバックアップの内容で置き換えます。よろしいですか？")) return;
        setData(d);
        setTeamId((d.teams[0] || {}).id);
      } catch (err) {
        alert("バックアップファイルを読み込めませんでした");
      }
    };
    reader.readAsText(file);
  };

  const resetData = () => {
    if (!confirm("入力した内容を消して、Excelから取り込んだ初期データに戻します。よろしいですか？")) return;
    const d = cloneSeed();
    setData(d);
    setTeamId((d.teams[0] || {}).id);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: "32px 16px", fontFamily: FONT }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 4, color: C.dim, marginBottom: 8, textTransform: "uppercase" }}>Vehicle Inspection</div>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: C.text, lineHeight: 1.2 }}>車輌点検一覧表</h1>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 6 }}>㈱奥村商事</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => setYear(year - 1)} style={{ ...btn(C.line, C.sub), width: 36 }}>‹</button>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text, fontFamily: MONO, minWidth: 80, textAlign: "center" }}>{year}年</div>
            <button onClick={() => setYear(year + 1)} style={{ ...btn(C.line, C.sub), width: 36 }}>›</button>
          </div>
        </div>

        <SummaryCards vehicles={data.vehicles} year={year} />

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {data.teams.map(t => {
            const active = team && t.id === team.id;
            const overdue = data.vehicles.filter(v => v.teamId === t.id && !v.sold)
              .flatMap(v => v.items.filter(i => i.year === year)).filter(i => itemStatus(i) === "overdue").length;
            return (
              <button key={t.id} onClick={() => setTeamId(t.id)} style={{
                padding: "8px 14px", borderRadius: 20, cursor: "pointer", fontFamily: FONT, fontSize: 13,
                border: `1px solid ${active ? C.shaken : C.line}`, background: active ? `${C.shaken}33` : C.panel,
                color: active ? C.text : C.sub, fontWeight: active ? 700 : 400,
              }}>
                {t.name}
                {overdue > 0 && <span style={{ marginLeft: 6, color: C.overdue, fontFamily: MONO, fontSize: 11 }}>●{overdue}</span>}
              </button>
            );
          })}
          <button onClick={addTeam} style={{ ...ghostBtn, borderRadius: 20, padding: "8px 14px" }}>＋ チーム</button>
        </div>

        {team && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: C.sub }}>
                {vehicles.length}台{team.checker ? ` ・ チェック担当：${team.checker}` : ""} ・ マスをタップで点検を入力 / 車番をタップで車輌編集
              </div>
              <button onClick={() => setVehicleEdit({ plate: "", driver: "", expiry: "", memo: "", sold: false, teamId: team.id, items: [] })}
                style={btn("#2a6ef5")}>＋ 車輌を追加</button>
            </div>

            <InspectionTable
              vehicles={vehicles}
              year={year}
              onCell={(v, m) => setCellEdit({ vehicle: v, month: m })}
              onVehicle={(v) => setVehicleEdit(v)}
            />

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: C.sub, marginTop: 10 }}>
              {["done", "now", "overdue", "plan"].map(s => (
                <span key={s}><span style={{ color: C[s] }}>■</span> {STATUS_LABEL[s]}</span>
              ))}
              <span><span style={{ color: C.shaken }}>▌</span> 車検</span>
            </div>

            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20, marginTop: 20 }}>
              <div style={{ fontSize: 12, color: C.dim, letterSpacing: 2, marginBottom: 10 }}>{team.name} の備考</div>
              <textarea value={team.notes} rows={3} onChange={e => updateTeamNotes(e.target.value)}
                placeholder="車検証の依頼状況・請求の扱いなど"
                style={{ ...inputStyle, background: C.bg, resize: "vertical" }} />
            </div>
          </>
        )}

        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20, marginTop: 20 }}>
          <div style={{ fontSize: 12, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>DATA</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => downloadCSV(data, year)} style={btn("#1e6f3f", "#d5f5e3")}>📊 {year}年をCSVで書き出し</button>
            <button onClick={exportJSON} style={ghostBtn}>バックアップ保存</button>
            <label style={{ ...ghostBtn, display: "inline-block" }}>
              バックアップから復元
              <input type="file" accept="application/json,.json" onChange={importJSON} style={{ display: "none" }} />
            </label>
            <button onClick={resetData} style={ghostBtn}>初期データに戻す</button>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: "#333", lineHeight: 1.8 }}>
          ※データはこの端末内に保存されます。他の端末と共有するときはバックアップを使ってください<br />
          ※車検完了後は車輌編集から車検有効期限を更新してください
        </div>
      </div>

      {cellEdit && (
        <ItemEditor vehicle={cellEdit.vehicle} year={year} month={cellEdit.month}
          onSave={saveVehicle} onClose={() => setCellEdit(null)} />
      )}
      {vehicleEdit && (
        <VehicleEditor vehicle={vehicleEdit} teams={data.teams} year={year}
          onSave={saveVehicle} onDelete={deleteVehicle} onClose={() => setVehicleEdit(null)} />
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
