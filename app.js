const { useState, useRef, useEffect } = React;

const FUEL_EFFICIENCY = 3.5;   // km/L
const LABOR_HOURLY = 2500;     // 円/時

// ドライバー一覧（追加・変更はこの配列を編集）
const DRIVERS = [
  "海野", "八幡", "藤井", "原田", "米島", "稲葉",
  "森下", "清水 宏樹", "古井", "大澤", "今井", "山崎",
  "萩野", "神谷", "廣田", "相野", "水林", "辻",
  "菅原", "石塚 和幸", "奥野", "加納", "坂井", "村口",
  "中村", "中野", "高津", "小倉", "清水 慎也",
];

const DEPRECIATION_COST = 2500;
const INSURANCE_COST = 750;
const INSPECTION_COST = 1800;
const REPAIR_COST = 1500;
const OFFICE_COST = 3300;

const STORAGE_KEY = "freight-calc-history-v1";

/* ---------- 保存まわり（端末内 localStorage） ---------- */

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

/* ---------- CSV出力 ---------- */

const CSV_COLUMNS = [
  { key: "savedAt",       label: "保存日時" },
  { key: "driver",        label: "ドライバー" },
  { key: "distance",      label: "走行距離km" },
  { key: "fuelPrice",     label: "燃料単価円/L" },
  { key: "laborHours",    label: "労働時間h" },
  { key: "overtimeHours", label: "残業時間h" },
  { key: "tollFee",       label: "高速代円" },
  { key: "fuelCost",      label: "燃料費円" },
  { key: "laborCost",     label: "人件費円" },
  { key: "overtimeCost",  label: "残業代円" },
  { key: "totalCost",     label: "総コスト円" },
  { key: "fairFreight",   label: "適正運賃円" },
  { key: "currentFreight",label: "運賃総額円" },
  { key: "diff",          label: "差額円" },
  { key: "note",          label: "メモ" },
];

function toCSV(records) {
  const esc = (val) => {
    const s = val === undefined || val === null ? "" : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = CSV_COLUMNS.map(c => esc(c.label)).join(",");
  const rows = records.map(r =>
    CSV_COLUMNS.map(c => {
      if (c.key === "savedAt") {
        const d = new Date(r.savedAt);
        const p = (n) => String(n).padStart(2, "0");
        return esc(`${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`);
      }
      return esc(r[c.key]);
    }).join(",")
  );
  return [header, ...rows].join("\r\n");
}

function downloadCSV(records) {
  const csv = toCSV(records);
  // BOM付きUTF-8 → Excelで開いても文字化けしない
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const a = document.createElement("a");
  a.href = url;
  a.download = `運賃計算履歴_${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- UI部品 ---------- */

function Slider({ label, value, min, max, step, onChange, unit, color }) {
  const pct = ((value - min) / (max - min)) * 100;
  const trackRef = useRef(null);

  const calcValue = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const raw = min + ratio * (max - min);
    const stepped = Math.round(raw / step) * step;
    return Math.min(Math.max(parseFloat(stepped.toFixed(10)), min), max);
  };

  const handleTouchStart = (e) => { e.preventDefault(); onChange(calcValue(e.touches[0].clientX)); };
  const handleTouchMove  = (e) => { e.preventDefault(); onChange(calcValue(e.touches[0].clientX)); };
  const decrement = () => onChange(Math.max(parseFloat((value - step).toFixed(10)), min));
  const increment = () => onChange(Math.min(parseFloat((value + step).toFixed(10)), max));

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: "#8a8f98", fontFamily: "'Noto Sans JP', sans-serif" }}>{label}</span>
        <span style={{ fontSize: 20, fontWeight: 700, color: "#e8eaf0", fontFamily: "'DM Mono', monospace" }}>
          {value.toLocaleString()}<span style={{ fontSize: 13, color: "#8a8f98", marginLeft: 3 }}>{unit}</span>
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={decrement} style={{
          width: 32, height: 32, borderRadius: 8, border: "none", background: "#2a2d35",
          color: "#8a8f98", fontSize: 18, cursor: "pointer", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700
        }}>−</button>
        <div ref={trackRef} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove}
          style={{ position: "relative", height: 36, flex: 1, display: "flex", alignItems: "center", touchAction: "none" }}>
          <div style={{ position: "absolute", left: 0, right: 0, height: 6, borderRadius: 3, background: "#2a2d35" }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, borderRadius: 3, background: `linear-gradient(90deg, ${color}88, ${color})` }} />
          </div>
          <div style={{ position: "absolute", top: "50%", left: `${pct}%`, transform: "translate(-50%, -50%)", width: 22, height: 22, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}`, pointerEvents: "none", zIndex: 1 }} />
          <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", margin: 0, zIndex: 2, touchAction: "none" }} />
        </div>
        <button onClick={increment} style={{
          width: 32, height: 32, borderRadius: 8, border: "none", background: "#2a2d35",
          color: "#8a8f98", fontSize: 18, cursor: "pointer", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700
        }}>＋</button>
      </div>
    </div>
  );
}

function CostBar({ label, amount, total, color }) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "#8a8f98" }}>{label}</span>
        <span style={{ fontSize: 12, color: "#c8cad0", fontFamily: "'DM Mono', monospace" }}>
          ¥{amount.toLocaleString()} <span style={{ color: "#555" }}>({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "#2a2d35" }}>
        <div style={{ height: "100%", borderRadius: 2, width: `${pct}%`, background: color, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- ドライバー別集計 ---------- */

function SummaryPanel({ records }) {
  if (records.length === 0) return null;

  const byDriver = {};
  records.forEach(r => {
    if (!byDriver[r.driver]) byDriver[r.driver] = { count: 0, freight: 0, fair: 0, diff: 0, distance: 0 };
    const b = byDriver[r.driver];
    b.count += 1;
    b.freight += r.currentFreight || 0;
    b.fair += r.fairFreight || 0;
    b.diff += r.diff || 0;
    b.distance += r.distance || 0;
  });

  const rows = Object.entries(byDriver)
    .map(([driver, b]) => ({ driver, ...b, avgFreight: Math.round(b.freight / b.count) }))
    .sort((a, b) => a.diff - b.diff); // 差額が小さい（＝儲かっている）順

  return (
    <div style={{ background: "#1a1d24", borderRadius: 16, padding: 24, marginTop: 20, border: "1px solid #2a2d35" }}>
      <div style={{ fontSize: 12, color: "#555", letterSpacing: 2, marginBottom: 16 }}>ドライバー別集計</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "#555" }}>
              <th style={{ textAlign: "left", padding: "6px 4px", fontWeight: 400 }}>ドライバー</th>
              <th style={{ textAlign: "right", padding: "6px 4px", fontWeight: 400 }}>件数</th>
              <th style={{ textAlign: "right", padding: "6px 4px", fontWeight: 400 }}>平均運賃</th>
              <th style={{ textAlign: "right", padding: "6px 4px", fontWeight: 400 }}>差額計</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.driver} style={{ borderTop: "1px solid #2a2d35" }}>
                <td style={{ padding: "8px 4px", color: "#e8eaf0" }}>{r.driver}</td>
                <td style={{ padding: "8px 4px", textAlign: "right", color: "#8a8f98", fontFamily: "'DM Mono', monospace" }}>{r.count}</td>
                <td style={{ padding: "8px 4px", textAlign: "right", color: "#c8cad0", fontFamily: "'DM Mono', monospace" }}>¥{r.avgFreight.toLocaleString()}</td>
                <td style={{ padding: "8px 4px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: r.diff > 0 ? "#ff6b6b" : "#4ade80" }}>
                  {r.diff > 0 ? "▲" : "▼"}¥{Math.abs(r.diff).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: "#444", marginTop: 12, lineHeight: 1.6 }}>
        ▼＝適正運賃を上回っている（黒字寄り） / ▲＝不足している
      </div>
    </div>
  );
}

/* ---------- 履歴パネル ---------- */

function HistoryPanel({ records, driverFilter, setDriverFilter, onDelete, onClearAll }) {
  const filtered = driverFilter === "全員"
    ? records
    : records.filter(h => h.driver === driverFilter);

  return (
    <div style={{ background: "#1a1d24", borderRadius: 16, padding: 24, marginTop: 20, border: "1px solid #2a2d35" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 8 }}>
        <div style={{ fontSize: 12, color: "#555", letterSpacing: 2 }}>HISTORY（{filtered.length}件）</div>
        <select value={driverFilter} onChange={e => setDriverFilter(e.target.value)} style={{
          background: "#2a2d35", color: "#e8eaf0", border: "none", borderRadius: 8,
          padding: "6px 10px", fontSize: 12, fontFamily: "'Noto Sans JP', sans-serif", maxWidth: 160
        }}>
          <option value="全員">全員</option>
          {DRIVERS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {records.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={() => downloadCSV(records)} style={{
            flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#1e6f3f",
            color: "#d5f5e3", fontSize: 12, fontWeight: 700, cursor: "pointer",
            fontFamily: "'Noto Sans JP', sans-serif"
          }}>📊 CSVで書き出し（全{records.length}件）</button>
          <button onClick={onClearAll} style={{
            padding: "10px 14px", borderRadius: 8, border: "1px solid #3a3d45", background: "transparent",
            color: "#8a8f98", fontSize: 12, cursor: "pointer", fontFamily: "'Noto Sans JP', sans-serif", flexShrink: 0
          }}>全削除</button>
        </div>
      )}

      {filtered.length === 0 && (
        <div style={{ fontSize: 12, color: "#8a8f98" }}>まだ保存された計算結果がありません</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto" }}>
        {filtered.map(h => {
          const isUnder = h.diff > 0;
          const accent = isUnder ? "#ff6b6b" : "#4ade80";
          return (
            <div key={h.id} style={{
              background: "#13151a", borderRadius: 10, padding: 12,
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#e8eaf0" }}>{h.driver}</div>
                <div style={{ fontSize: 11, color: "#8a8f98", marginTop: 2 }}>
                  {formatDate(h.savedAt)} ・ {h.distance}km
                </div>
                <div style={{ fontSize: 11, color: "#8a8f98", marginTop: 2 }}>
                  運賃 ¥{(h.currentFreight || 0).toLocaleString()} / 適正 ¥{(h.fairFreight || 0).toLocaleString()}
                </div>
                {h.note && <div style={{ fontSize: 11, color: "#6a6f78", marginTop: 3 }}>📝 {h.note}</div>}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: accent, fontFamily: "'DM Mono', monospace" }}>
                  {isUnder ? "▲" : "▼"}¥{Math.abs(h.diff).toLocaleString()}
                </div>
                <button onClick={() => onDelete(h.id)} style={{
                  marginTop: 6, background: "none", border: "none", color: "#555",
                  fontSize: 11, cursor: "pointer", textDecoration: "underline"
                }}>削除</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- メイン ---------- */

function App() {
  const [distance, setDistance] = useState(200);
  const [fuelPrice, setFuelPrice] = useState(135);
  const [laborHours, setLaborHours] = useState(8);
  const [tollFee, setTollFee] = useState(0);
  const [overtimeHours, setOvertimeHours] = useState(0);
  const [currentFreight, setCurrentFreight] = useState(40000);
  const [driver, setDriver] = useState(DRIVERS[0]);
  const [note, setNote] = useState("");

  const [records, setRecords] = useState([]);
  const [driverFilter, setDriverFilter] = useState("全員");
  const [saveStatus, setSaveStatus] = useState("");

  useEffect(() => { setRecords(loadRecords()); }, []);

  const fuelCost = Math.round((distance / FUEL_EFFICIENCY) * fuelPrice);
  const laborCost = Math.round(LABOR_HOURLY * laborHours);
  const overtimeCost = Math.round(3125 * overtimeHours);
  const totalCost = fuelCost + laborCost + overtimeCost + tollFee + DEPRECIATION_COST + INSURANCE_COST + INSPECTION_COST + REPAIR_COST + OFFICE_COST;
  const fairFreight = Math.round(totalCost / 100) * 100;
  const diff = fairFreight - currentFreight;
  const isUnder = diff > 0;
  const accent = isUnder ? "#ff6b6b" : "#4ade80";
  const accentDim = isUnder ? "#ff6b6b44" : "#4ade8044";

  const handleSave = () => {
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
      driver,
      distance, fuelPrice, laborHours, overtimeHours, tollFee,
      fuelCost, laborCost, overtimeCost,
      totalCost, fairFreight, currentFreight, diff,
      note: note.trim(),
    };
    const next = [record, ...records];
    setRecords(next);
    saveRecords(next);
    setNote("");
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus(""), 2000);
  };

  const handleDelete = (id) => {
    const next = records.filter(r => r.id !== id);
    setRecords(next);
    saveRecords(next);
  };

  const handleClearAll = () => {
    if (!confirm(`保存済みの${records.length}件をすべて削除します。\nCSVで書き出し済みか確認してください。よろしいですか？`)) return;
    setRecords([]);
    saveRecords([]);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#13151a", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "32px 16px", fontFamily: "'Noto Sans JP', sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 560 }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, letterSpacing: 4, color: "#555", marginBottom: 8, textTransform: "uppercase" }}>Freight Rate Calculator</div>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: "#e8eaf0", margin: 0, lineHeight: 1.2 }}>運賃適正価格<br />計算ツール</h1>
        </div>

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, color: "#8a8f98", marginBottom: 10 }}>ドライバー選択</div>
          <select value={driver} onChange={e => setDriver(e.target.value)} style={{
            width: "100%", background: "#1e2128", color: "#e8eaf0", border: "1px solid #2a2d35",
            borderRadius: 8, padding: "12px", fontSize: 15, fontFamily: "'Noto Sans JP', sans-serif"
          }}>
            {DRIVERS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        <div style={{ background: "#1a1d24", borderRadius: 16, padding: 24, marginBottom: 20, border: "1px solid #2a2d35" }}>
          <Slider label="走行距離" value={distance} min={50} max={1000} step={1} onChange={setDistance} unit="km" color="#2a6ef5" />
          <Slider label="燃料単価" value={fuelPrice} min={80} max={220} step={1} onChange={setFuelPrice} unit="円/L" color="#f59e0b" />
          <Slider label="労働時間" value={laborHours} min={4} max={16} step={0.5} onChange={setLaborHours} unit="時間" color="#a78bfa" />
          <Slider label="残業時間（¥3,125/h）" value={overtimeHours} min={0} max={8} step={0.25} onChange={setOvertimeHours} unit="時間" color="#f472b6" />
          <Slider label="高速道路代" value={tollFee} min={0} max={20000} step={500} onChange={setTollFee} unit="円" color="#06b6d4" />
          <div style={{ marginTop: 4 }}>
            <Slider label="運賃総額" value={currentFreight} min={10000} max={200000} step={500} onChange={setCurrentFreight} unit="円" color="#ff6b6b" />
          </div>
        </div>

        <div style={{ background: "#1a1d24", borderRadius: 16, padding: 24, marginBottom: 20, border: "1px solid #2a2d35" }}>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 16, letterSpacing: 2 }}>COST BREAKDOWN</div>
          <CostBar label={`燃料費（燃費 ${FUEL_EFFICIENCY}km/L）`} amount={fuelCost} total={totalCost} color="#f59e0b" />
          <CostBar label={`人件費（時給 ¥${LABOR_HOURLY.toLocaleString()}×${laborHours}h）`} amount={laborCost} total={totalCost} color="#a78bfa" />
          {overtimeCost > 0 && <CostBar label={`残業代（¥3,125×${Math.floor(overtimeHours)}h${overtimeHours % 1 ? `${overtimeHours % 1 * 60}分` : ""}）`} amount={overtimeCost} total={totalCost} color="#f472b6" />}
          <CostBar label="高速道路代" amount={tollFee} total={totalCost} color="#06b6d4" />
          <CostBar label="車両償却" amount={DEPRECIATION_COST} total={totalCost} color="#64748b" />
          <CostBar label="保険" amount={INSURANCE_COST} total={totalCost} color="#94a3b8" />
          <CostBar label="点検費" amount={INSPECTION_COST} total={totalCost} color="#34d399" />
          <CostBar label="修繕費" amount={REPAIR_COST} total={totalCost} color="#fb923c" />
          <CostBar label="事務所・管理費等" amount={OFFICE_COST} total={totalCost} color="#e879f9" />
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #2a2d35", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "#8a8f98" }}>総コスト</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#e8eaf0", fontFamily: "'DM Mono', monospace" }}>¥{totalCost.toLocaleString()}</span>
          </div>
        </div>

        <div style={{ background: "#1a1d24", borderRadius: 16, padding: 28, border: `1px solid ${accentDim}`, boxShadow: `0 0 24px ${accentDim}` }}>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 20, letterSpacing: 2 }}>RESULT</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            <div style={{ background: "#13151a", borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>運賃総額</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#ff6b6b", fontFamily: "'DM Mono', monospace" }}>¥{currentFreight.toLocaleString()}</div>
            </div>
            <div style={{ background: "#13151a", borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>適正運賃</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#4ade80", fontFamily: "'DM Mono', monospace" }}>¥{fairFreight.toLocaleString()}</div>
            </div>
          </div>
          <div style={{ background: isUnder ? "#ff6b6b11" : "#4ade8011", border: `1px solid ${accentDim}`, borderRadius: 12, padding: 20, textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "#8a8f98", marginBottom: 8 }}>{isUnder ? "運賃総額との差額（不足分）" : "運賃総額との差額"}</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: accent, fontFamily: "'DM Mono', monospace", textShadow: `0 0 20px ${accent}66` }}>
              {isUnder ? "▲" : "▼"} ¥{Math.abs(diff).toLocaleString()}
            </div>
            <div style={{ display: "inline-block", marginTop: 10, padding: "4px 14px", borderRadius: 20, background: isUnder ? "#ff6b6b22" : "#4ade8022", border: `1px solid ${accent}66` }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: accent, fontFamily: "'DM Mono', monospace" }}>
                {currentFreight > 0 ? (Math.abs(diff) / currentFreight * 100).toFixed(1) : "—"}%
              </span>
              <span style={{ fontSize: 12, color: "#8a8f98", marginLeft: 6 }}>{isUnder ? "不足率" : ""}</span>
            </div>
            <div style={{ fontSize: 13, color: "#8a8f98", marginTop: 12, lineHeight: 1.7 }}>
              {isUnder ? `運賃総額は適正価格より不足しています。\n交渉目標：¥${fairFreight.toLocaleString()} 以上` : "運賃総額は適正価格を上回っています。"}
            </div>
          </div>
          {isUnder && (
            <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: "#1e2128", fontSize: 12, color: "#8a8f98", lineHeight: 1.8 }}>
              💡 <strong style={{ color: "#e8eaf0" }}>交渉アドバイス</strong><br />
              国土交通省の標準的な運賃告示を根拠に提示しましょう。<br />
              燃料サーチャージ制度の導入も合わせて提案すると効果的です。
            </div>
          )}

          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="メモ（荷主名・行き先など）任意"
            style={{
              width: "100%", marginTop: 20, padding: "12px", borderRadius: 8,
              border: "1px solid #2a2d35", background: "#13151a", color: "#e8eaf0",
              fontSize: 14, fontFamily: "'Noto Sans JP', sans-serif"
            }}
          />

          <button onClick={handleSave} style={{
            width: "100%", marginTop: 10, padding: "14px", borderRadius: 10, border: "none",
            background: saveStatus === "saved" ? "#4ade80" : "#2a6ef5",
            color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
            fontFamily: "'Noto Sans JP', sans-serif", transition: "background 0.2s"
          }}>
            {saveStatus === "saved" ? "✓ 保存しました" : `この計算結果を保存（${driver}）`}
          </button>
        </div>

        <SummaryPanel records={records} />

        <HistoryPanel
          records={records}
          driverFilter={driverFilter}
          setDriverFilter={setDriverFilter}
          onDelete={handleDelete}
          onClearAll={handleClearAll}
        />

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: "#333", lineHeight: 1.8 }}>
          ※概算値です。実際のコストに合わせてパラメータを調整してください<br />
          ※データはこの端末内に保存されます。定期的にCSVで書き出してください
        </div>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
