const { useState, useEffect, useMemo } = React;

const STORAGE_KEY = "teppan-records-v1";
const SETTINGS_KEY = "teppan-settings-v1";
const DEFAULT_TOTAL = 134; // Excelの総枚数欄の値

const C = {
  bg: "#13151a", card: "#1a1d24", line: "#2a2d35", sub: "#8a8f98", dim: "#555",
  text: "#e8eaf0", green: "#3ddc84", red: "#ff6b6b", blue: "#5b9dff", amber: "#ffb347",
};

/* ---------- 保存まわり（端末内 localStorage） ---------- */

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return SEED_RECORDS.map(r => ({ ...r }));
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return SEED_RECORDS.map(r => ({ ...r }));
  }
}

function loadSettings() {
  try {
    return { totalSheets: DEFAULT_TOTAL, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch (e) {
    return { totalSheets: DEFAULT_TOTAL };
  }
}

/* ---------- 日付 ---------- */

const pad = (n) => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = (iso) => iso ? iso.replace(/-/g, "/") : "―";
const shortDate = (iso) => { const [, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}`; };
const daysSince = (iso) => iso ? Math.floor((new Date(todayISO()) - new Date(iso)) / 86400000) : null;

/* ---------- CSV出力 ---------- */

const CSV_COLUMNS = [
  { key: "no", label: "No." },
  { key: "status", label: "状態" },
  { key: "returnInfo", label: "撤去情報" },
  { key: "count", label: "枚数" },
  { key: "lendDate", label: "貸出日" },
  { key: "company", label: "貸出先" },
  { key: "site", label: "現場名" },
  { key: "person", label: "担当者" },
  { key: "note", label: "備考" },
];

function downloadFile(content, filename, type) {
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

function downloadCSV(records) {
  const esc = (v) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = records.map(r => CSV_COLUMNS.map(c => {
    if (c.key === "status") return esc(r.status === "active" ? "貸出中" : "撤去済み");
    if (c.key === "lendDate") return esc(fmtDate(r.lendDate));
    return esc(r[c.key]);
  }).join(","));
  const csv = [CSV_COLUMNS.map(c => c.label).join(","), ...rows].join("\r\n");
  const d = new Date();
  // BOM付きUTF-8 → Excelで開いても文字化けしない
  downloadFile("﻿" + csv, `敷き鉄板貸出管理_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv`, "text/csv;charset=utf-8;");
}

/* ---------- UI部品 ---------- */

const inputStyle = {
  width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.line}`,
  background: C.bg, color: C.text, fontSize: 16, outline: "none",
};

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}

function Btn({ children, onClick, color = C.line, fg = C.text, style }) {
  return (
    <button onClick={onClick} style={{
      padding: "10px 14px", borderRadius: 10, border: "none", background: color, color: fg,
      fontSize: 14, fontWeight: 700, cursor: "pointer", ...style,
    }}>{children}</button>
  );
}

function Stepper({ value, onChange, min = 0 }) {
  const b = { width: 44, height: 44, borderRadius: 10, border: "none", background: C.line, color: C.text, fontSize: 20, fontWeight: 700, cursor: "pointer" };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button type="button" style={b} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <input type="number" inputMode="numeric" value={value}
        onChange={e => onChange(Math.max(min, parseInt(e.target.value || "0", 10)))}
        style={{ ...inputStyle, textAlign: "center", fontFamily: "'DM Mono', monospace", fontSize: 20, flex: 1 }} />
      <button type="button" style={b} onClick={() => onChange(value + 1)}>＋</button>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto",
        borderRadius: "18px 18px 0 0", padding: "20px 16px 28px", border: `1px solid ${C.line}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.sub, fontSize: 24, cursor: "pointer" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- 貸出の登録・編集 ---------- */

function RecordForm({ initial, companies, persons, onSave, onDelete, onClose }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target ? e.target.value : e });
  const valid = f.company.trim() && f.count >= 0 && f.lendDate;

  return (
    <Modal title={initial.id ? "貸出を編集" : "新規貸出"} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="No."><input style={inputStyle} value={f.no} onChange={set("no")} /></Field>
        <Field label="貸出日"><input type="date" style={inputStyle} value={f.lendDate} onChange={set("lendDate")} /></Field>
      </div>
      <Field label="枚数"><Stepper value={f.count} onChange={set("count")} /></Field>
      <Field label="貸出先 *">
        <input style={inputStyle} list="companies" value={f.company} onChange={set("company")} placeholder="例：玉家建設" />
        <datalist id="companies">{companies.map(c => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label="現場名"><input style={inputStyle} value={f.site} onChange={set("site")} placeholder="例：〇〇邸" /></Field>
      <Field label="担当者">
        <input style={inputStyle} list="persons" value={f.person} onChange={set("person")} />
        <datalist id="persons">{persons.map(c => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label="備考"><textarea style={{ ...inputStyle, minHeight: 64 }} value={f.note} onChange={set("note")} placeholder="例：3×6 2枚 ニッショウでレンタル" /></Field>
      {initial.id && (
        <>
          <Field label="状態">
            <select style={inputStyle} value={f.status} onChange={set("status")}>
              <option value="active">貸出中</option>
              <option value="returned">撤去済み</option>
            </select>
          </Field>
          {f.status === "returned" && (
            <Field label="撤去情報"><input style={inputStyle} value={f.returnInfo} onChange={set("returnInfo")} /></Field>
          )}
        </>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        {initial.id && <Btn color="#3a1f24" fg={C.red} onClick={() => { if (confirm("この記録を削除しますか？")) onDelete(f.id); }}>削除</Btn>}
        <Btn color={valid ? C.green : C.line} fg={valid ? "#0b2416" : C.dim} style={{ flex: 1 }}
          onClick={() => valid && onSave({ ...f, company: f.company.trim(), site: f.site.trim(), person: f.person.trim() })}>保存</Btn>
      </div>
    </Modal>
  );
}

/* ---------- 撤去（全数・一部） ---------- */

function ReturnForm({ record, onSave, onClose }) {
  const [n, setN] = useState(record.count);
  const [date, setDate] = useState(todayISO());
  const partial = n < record.count;

  const save = () => {
    const label = `${shortDate(date)} ${n}枚撤去`;
    if (partial) {
      onSave({ ...record, count: record.count - n, note: [record.note, label].filter(Boolean).join(" / ") });
    } else {
      onSave({ ...record, status: "returned", returnInfo: `${fmtDate(date)} 撤去`, returnDate: date });
    }
  };

  return (
    <Modal title="撤去を記録" onClose={onClose}>
      <div style={{ fontSize: 14, color: C.sub, marginBottom: 16 }}>
        {record.company}｜{record.site || "現場名なし"}（貸出中 {record.count}枚）
      </div>
      <Field label="撤去日"><input type="date" style={inputStyle} value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="撤去枚数"><Stepper value={n} min={1} onChange={v => setN(Math.min(v, Math.max(record.count, 1)))} /></Field>
      <div style={{ fontSize: 12, color: partial ? C.amber : C.sub, marginBottom: 14 }}>
        {partial ? `一部撤去：残り ${record.count - n}枚 は貸出中のままです` : "全数撤去：撤去済みになります"}
      </div>
      <Btn color={C.blue} fg="#0b1730" style={{ width: "100%" }} onClick={save}>撤去を記録</Btn>
    </Modal>
  );
}

/* ---------- 実質在庫（置き場で数えた枚数） ---------- */

function ActualStockForm({ settings, calcStock, onSave, onClose }) {
  const [n, setN] = useState(settings.actualStock ?? Math.max(calcStock, 0));
  const [date, setDate] = useState(todayISO());
  return (
    <Modal title="実質在庫を入力" onClose={onClose}>
      <div style={{ fontSize: 13, color: C.sub, marginBottom: 16, lineHeight: 1.6 }}>
        置き場にある敷き鉄板を実際に数えた枚数を入力してください。貸出記録の枚数が不明・不正確でも、実際の在庫と貸出枚数がわかります。
      </div>
      <Field label="確認日"><input type="date" style={inputStyle} value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="置き場の枚数"><Stepper value={n} onChange={setN} /></Field>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        {settings.actualStock != null && (
          <Btn color="#3a1f24" fg={C.red} onClick={() => onSave(null, "")}>クリア</Btn>
        )}
        <Btn color={C.green} fg="#0b2416" style={{ flex: 1 }} onClick={() => onSave(n, date)}>保存</Btn>
      </div>
    </Modal>
  );
}

function ActualStockCard({ settings, lent, calcStock, onEdit }) {
  const actual = settings.actualStock;
  const has = actual !== null && actual !== undefined;
  const actualLent = settings.totalSheets - (actual || 0);
  const diff = has ? actual - calcStock : 0;
  return (
    <div onClick={onEdit} style={{
      background: C.card, borderRadius: 14, padding: "14px 16px", marginBottom: 16, cursor: "pointer",
      border: `1px solid ${has ? "#4a3a1c" : C.line}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 12, color: C.sub }}>
            実質在庫（置き場で確認）{has && settings.actualStockDate && <span> ・ {fmtDate(settings.actualStockDate)}確認</span>}
          </div>
          {has ? (
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 30, fontWeight: 500, color: C.amber, marginTop: 2 }}>
              {actual}<span style={{ fontSize: 12, color: C.sub, marginLeft: 2 }}>枚</span>
            </div>
          ) : (
            <div style={{ fontSize: 14, color: C.dim, marginTop: 6 }}>未入力 ― 置き場の枚数を数えて入力</div>
          )}
        </div>
        <span style={{ padding: "8px 12px", borderRadius: 10, background: "#3a2e18", color: C.amber, fontSize: 13, fontWeight: 700 }}>
          {has ? "更新" : "入力"}
        </span>
      </div>
      {has && (
        <div style={{ display: "flex", gap: 16, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}`, fontSize: 12, color: C.sub, flexWrap: "wrap" }}>
          <div>実質貸出 <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, color: C.text }}>{actualLent}枚</span></div>
          <div>記録との差 <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, color: diff === 0 ? C.green : C.amber }}>
            {diff > 0 ? "+" : ""}{diff}枚</span>
            <span style={{ color: C.dim }}>（記録上の貸出 {lent}枚）</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- 設定・バックアップ ---------- */

function SettingsPanel({ settings, setSettings, records, setRecords, onClose }) {
  const importJSON = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const recs = Array.isArray(data) ? data : data.records;
        if (!Array.isArray(recs)) throw new Error();
        if (confirm(`${recs.length}件のデータで置き換えますか？（今のデータは消えます）`)) {
          setRecords(recs);
          if (data.settings) setSettings({ ...settings, ...data.settings });
          onClose();
        }
      } catch (err) {
        alert("読み込めませんでした。バックアップ用のJSONファイルを選んでください。");
      }
    };
    reader.readAsText(file);
  };

  return (
    <Modal title="設定・データ" onClose={onClose}>
      <Field label="総枚数（自社保有の敷き鉄板）">
        <Stepper value={settings.totalSheets} onChange={v => setSettings({ ...settings, totalSheets: v })} />
      </Field>
      <div style={{ fontSize: 12, color: C.sub, margin: "20px 0 8px" }}>書き出し</div>
      <div style={{ display: "grid", gap: 8 }}>
        <Btn onClick={() => downloadCSV(records)}>CSV（Excelで開ける）</Btn>
        <Btn onClick={() => downloadFile(JSON.stringify({ records, settings }, null, 1),
          `teppan-backup-${todayISO()}.json`, "application/json")}>バックアップ（JSON）</Btn>
      </div>
      <div style={{ fontSize: 12, color: C.sub, margin: "20px 0 8px" }}>読み込み</div>
      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ padding: "10px 14px", borderRadius: 10, background: C.line, fontSize: 14, fontWeight: 700, textAlign: "center", cursor: "pointer" }}>
          バックアップから復元
          <input type="file" accept="application/json,.json" onChange={importJSON} style={{ display: "none" }} />
        </label>
        <Btn color="#3a1f24" fg={C.red} onClick={() => {
          if (confirm("Excelから取り込んだ初期データに戻しますか？（追加・変更した内容は消えます）")) {
            setRecords(SEED_RECORDS.map(r => ({ ...r })));
            onClose();
          }
        }}>初期データに戻す</Btn>
      </div>
      <div style={{ fontSize: 11, color: C.dim, marginTop: 18, lineHeight: 1.6 }}>
        データはこの端末のブラウザ内に保存されます。機種変更や別の端末で使う場合は、バックアップ（JSON）を書き出して復元してください。
      </div>
    </Modal>
  );
}

/* ---------- 一覧の1行 ---------- */

function RecordCard({ r, onEdit, onReturn }) {
  const active = r.status === "active";
  const days = daysSince(r.lendDate);
  return (
    <div onClick={() => onEdit(r)} style={{
      background: C.card, borderRadius: 14, padding: "14px 14px", marginBottom: 10, cursor: "pointer",
      border: `1px solid ${active ? "#244a34" : C.line}`, opacity: active ? 1 : 0.6,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 52, textAlign: "center" }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 26, fontWeight: 500, color: active ? C.green : C.sub, lineHeight: 1 }}>{r.count}</div>
          <div style={{ fontSize: 10, color: C.sub, marginTop: 2 }}>枚</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, textDecoration: active ? "none" : "line-through" }}>
            {r.company}<span style={{ color: C.sub, fontWeight: 400 }}>｜{r.site || "―"}</span>
          </div>
          <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>
            {r.no && <span style={{ fontFamily: "'DM Mono', monospace", marginRight: 8 }}>No.{r.no}</span>}
            {fmtDate(r.lendDate)}〜 ・ 担当 {r.person || "―"}
            {active && days !== null && <span style={{ color: days > 90 ? C.amber : C.sub }}> ・ {days}日経過</span>}
          </div>
          {!active && r.returnInfo && <div style={{ fontSize: 12, color: C.blue, marginTop: 4 }}>{r.returnInfo}</div>}
          {r.note && <div style={{ fontSize: 12, color: "#b8bcc6", marginTop: 4 }}>{r.note}</div>}
        </div>
        {active && (
          <button onClick={e => { e.stopPropagation(); onReturn(r); }} style={{
            padding: "8px 10px", borderRadius: 10, border: "none", background: "#1d2a44", color: C.blue,
            fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0,
          }}>撤去</button>
        )}
      </div>
    </div>
  );
}

/* ---------- 貸出先別集計 ---------- */

function CompanySummary({ records }) {
  const rows = useMemo(() => {
    const m = {};
    records.filter(r => r.status === "active").forEach(r => {
      if (!m[r.company]) m[r.company] = { sites: 0, count: 0 };
      m[r.company].sites += 1;
      m[r.company].count += r.count || 0;
    });
    return Object.entries(m).sort((a, b) => b[1].count - a[1].count);
  }, [records]);

  if (rows.length === 0) return <div style={{ color: C.sub, textAlign: "center", padding: 40 }}>貸出中の鉄板はありません</div>;
  return (
    <div style={{ background: C.card, borderRadius: 14, padding: 16, border: `1px solid ${C.line}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ color: C.dim, fontSize: 12 }}>
            <th style={{ textAlign: "left", padding: "6px 4px", fontWeight: 400 }}>貸出先</th>
            <th style={{ textAlign: "right", padding: "6px 4px", fontWeight: 400 }}>現場数</th>
            <th style={{ textAlign: "right", padding: "6px 4px", fontWeight: 400 }}>貸出中</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, v]) => (
            <tr key={name} style={{ borderTop: `1px solid ${C.line}` }}>
              <td style={{ padding: "10px 4px" }}>{name}</td>
              <td style={{ padding: "10px 4px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: C.sub }}>{v.sites}</td>
              <td style={{ padding: "10px 4px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: C.green, fontWeight: 700 }}>{v.count}枚</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- メイン ---------- */

function App() {
  const [records, setRecords] = useState(loadRecords);
  const [settings, setSettings] = useState(loadSettings);
  const [tab, setTab] = useState("active");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [returning, setReturning] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editStock, setEditStock] = useState(false);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }, [records]);
  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);

  const lent = records.filter(r => r.status === "active").reduce((s, r) => s + (r.count || 0), 0);
  const stock = settings.totalSheets - lent;

  const uniq = (key) => [...new Set(records.map(r => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  const companies = useMemo(() => uniq("company"), [records]);
  const persons = useMemo(() => uniq("person"), [records]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records
      .filter(r => tab === "all" || r.status === tab)
      .filter(r => !q || [r.no, r.company, r.site, r.person, r.note, r.returnInfo].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (b.lendDate || "").localeCompare(a.lendDate || ""));
  }, [records, tab, query]);

  const nextNo = () => {
    const nums = records.map(r => parseInt(r.no, 10)).filter(n => !isNaN(n));
    return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, "0");
  };

  const newRecord = () => setEditing({
    id: "", no: nextNo(), count: 1, lendDate: todayISO(), company: "", site: "", person: "",
    note: "", status: "active", returnInfo: "",
  });

  const save = (rec) => {
    if (rec.id) setRecords(records.map(r => r.id === rec.id ? rec : r));
    else setRecords([...records, { ...rec, id: `r${Date.now()}` }]);
    setEditing(null);
    setReturning(null);
  };

  const remove = (id) => { setRecords(records.filter(r => r.id !== id)); setEditing(null); };

  const tabs = [
    ["active", `貸出中 ${records.filter(r => r.status === "active").length}`],
    ["returned", "撤去済み"],
    ["all", "すべて"],
    ["company", "貸出先別"],
  ];

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 100px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2 }}>STEEL PLATE</div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>敷き鉄板 貸出管理</div>
        </div>
        <button onClick={() => setShowSettings(true)} style={{
          background: C.card, border: `1px solid ${C.line}`, color: C.sub, borderRadius: 10,
          padding: "8px 12px", fontSize: 13, cursor: "pointer",
        }}>設定・出力</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
        {[
          ["総枚数", settings.totalSheets, C.text],
          ["貸出中", lent, C.green],
          ["計算在庫", stock, stock < 0 ? C.red : C.blue],
        ].map(([label, v, color]) => (
          <div key={label} style={{ background: C.card, borderRadius: 14, padding: "12px 8px", textAlign: "center", border: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 11, color: C.sub }}>{label}</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 26, fontWeight: 500, color, marginTop: 2 }}>
              {v}<span style={{ fontSize: 12, color: C.sub, marginLeft: 2 }}>枚</span>
            </div>
          </div>
        ))}
      </div>
      {stock < 0 && (
        <div style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>
          計算在庫がマイナスです。総枚数（設定）か、撤去済みの記録を確認してください。
        </div>
      )}
      <ActualStockCard settings={settings} lent={lent} calcStock={stock} onEdit={() => setEditStock(true)} />

      <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto" }}>
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: "8px 12px", borderRadius: 20, border: "none", whiteSpace: "nowrap", cursor: "pointer",
            background: tab === key ? C.text : C.card, color: tab === key ? C.bg : C.sub, fontSize: 13, fontWeight: 700,
          }}>{label}</button>
        ))}
      </div>

      {tab === "company" ? <CompanySummary records={records} /> : (
        <>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="貸出先・現場名・担当者で検索"
            style={{ ...inputStyle, marginBottom: 12 }} />
          {list.length === 0
            ? <div style={{ color: C.sub, textAlign: "center", padding: 40 }}>該当する記録はありません</div>
            : list.map(r => <RecordCard key={r.id} r={r} onEdit={setEditing} onReturn={setReturning} />)}
        </>
      )}

      <button onClick={newRecord} style={{
        position: "fixed", right: 20, bottom: 24, padding: "14px 22px", borderRadius: 30, border: "none",
        background: C.green, color: "#0b2416", fontSize: 16, fontWeight: 900, cursor: "pointer",
        boxShadow: "0 6px 20px rgba(61,220,132,0.35)",
      }}>＋ 貸出</button>

      {editing && <RecordForm initial={editing} companies={companies} persons={persons}
        onSave={save} onDelete={remove} onClose={() => setEditing(null)} />}
      {returning && <ReturnForm record={returning} onSave={save} onClose={() => setReturning(null)} />}
      {editStock && <ActualStockForm settings={settings} calcStock={stock} onClose={() => setEditStock(false)}
        onSave={(n, date) => { setSettings({ ...settings, actualStock: n, actualStockDate: date }); setEditStock(false); }} />}
      {showSettings && <SettingsPanel settings={settings} setSettings={setSettings}
        records={records} setRecords={setRecords} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
