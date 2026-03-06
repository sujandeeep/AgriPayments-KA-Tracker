import React, { useState, useMemo, useRef, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, CartesianGrid
} from "recharts";
import { SHEET_DATA } from "./data";
import { SEED, SEED_MONTHLY } from "./seed";
import { 
  INR, SHORT, PALETTE, classifyRows, parseSlipWithClaude, 
  exportUPTO, exportToExcel 
} from "./utils";

/* ─── Tooltip ────────────────────────────────────────────────────────────── */
const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#052e16", border: "1px solid #166534", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontFamily: "DM Mono,monospace" }}>
      <div style={{ color: "#86efac", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: "#d1fae5" }}>{p.name}: <span style={{ color: "#4ade80" }}>{String(p.name).toLowerCase().includes("amount") ? SHORT(p.value) : p.value}</span></div>
      ))}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════ */
export default function App() {
  const [locations, setLocations] = useState(SEED);
  const [monthly, setMonthly] = useState(SEED_MONTHLY);
  const [excelTxns, setExcelTxns] = useState<any[]>([]);
  const [slipTxns, setSlipTxns] = useState<any[]>([]);
  const [newLocations, setNewLocations] = useState<any[]>([]);
  const [slipQueue, setSlipQueue] = useState<any[]>([]);
  const [page, setPage] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("amount");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [chartMetric, setChartMetric] = useState<"amount" | "count">("amount");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [toast, setToast] = useState<{ msg: string, type: string } | null>(null);
  const [detailModal, setDetailModal] = useState<any>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const excelRef = useRef<HTMLInputElement>(null);
  const slipRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string, type = "success") => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 5000);
  }, []);

  const handleExcel = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (excelRef.current) excelRef.current.value = "";
    setUploading(true); setUploadMsg("Reading file…");
    try {
      if (!(window as any).XLSX) {
        setUploadMsg("Loading parser…");
        await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      }
      const XLSX = (window as any).XLSX; const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      let combinedLocs: any = {}, combinedMonths: any = {}, allTxns: any[] = [];
      for (const sheetName of wb.SheetNames) {
        if (sheetName.toUpperCase() === "SUMMARY") continue;
        const ws = wb.Sheets[sheetName]; const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (!rows.length || !rows[0]) continue; const headers = rows[0].map((h: any) => String(h || "").trim());
        if (!headers.includes("TXN_AMOUNT_IN_RS")) continue;
        setUploadMsg(`Classifying: ${sheetName}…`);
        const result = classifyRows(rows, headers);
        result.locations.forEach((l: any) => { if (!combinedLocs[l.keyword]) combinedLocs[l.keyword] = { ...l }; else { combinedLocs[l.keyword].count += l.count; combinedLocs[l.keyword].amount += l.amount; } });
        result.monthly.forEach((m: any) => { if (!combinedMonths[m.month]) combinedMonths[m.month] = { ...m }; else { combinedMonths[m.month].count += m.count; combinedMonths[m.month].amount += m.amount; } });
        allTxns.push(...result.transactions);
      }
      const newLocs = Object.values(combinedLocs).map((l: any) => ({ ...l, avg: l.count ? Math.round(l.amount / l.count) : 0 }));
      const existing = new Set(locations.map(l => l.keyword));
      const brandNew = newLocs.filter((l: any) => !existing.has(l.keyword) && l.keyword !== "UNCLASSIFIED");
      setLocations(prev => { const merged = { ...Object.fromEntries(prev.map(l => [l.keyword, l])) }; newLocs.forEach((l: any) => { merged[l.keyword] = { ...l, isNew: !existing.has(l.keyword) }; }); return Object.values(merged); });
      const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const sortedMonthly = Object.values(combinedMonths).sort((a: any, b: any) => { const p = (s: any) => { const [mo, yr] = s.month.split(" "); return parseInt(yr) * 12 + MONTHS.indexOf(mo); }; return p(a) - p(b); });
      setMonthly(sortedMonthly as any); setExcelTxns(allTxns); setNewLocations(brandNew);
      let msg = `✓ ${allTxns.length} transactions loaded, ${newLocs.length} locations.`;
      if (brandNew.length) msg += ` ${brandNew.length} NEW: ${brandNew.map((l: any) => l.keyword).join(", ")}.`;
      showToast(msg, brandNew.length ? "warn" : "success");
    } catch (err: any) { showToast("Error: " + err.message, "error"); }
    setUploading(false); setUploadMsg("");
  }, [locations, showToast]);

  const handleSlips = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[]; if (!files.length) return;
    const knownLocs = locations.map(l => l.keyword);
    const queue = files.map(f => ({ name: f.name, status: "queued", result: null, error: null }));
    setSlipQueue(queue); setPage("slips");
    for (let i = 0; i < files.length; i++) {
      const file = files[i] as File;
      setSlipQueue(prev => prev.map((p, j) => j === i ? { ...p, status: "processing" } : p));
      try {
        const mediaType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
        const base64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
        const parsed = await parseSlipWithClaude(base64, mediaType, knownLocs);
        const loc = (parsed.location || "UNCLASSIFIED").toUpperCase().trim(); const amt = parseFloat(parsed.amount) || 0;
        const txn = { location: loc, amount: amt, date: parsed.date || "", utr: parsed.utr || "", tranid: "", txtype: parsed.txtype || "UTR", sender: parsed.sender || "", receiver: parsed.receiver || "", status: "Completed", source: "slip", sourceFile: file.name, reference: parsed.reference || "", confidence: parsed.confidence || "medium", rawText: parsed.rawText || "" };
        if (loc !== "UNCLASSIFIED") { setLocations(prev => { const exists = prev.find(l => l.keyword === loc); if (exists) { if (amt > 0) return prev.map(l => { if (l.keyword !== loc) return l; const nc = l.count + 1, na = l.amount + amt; return { ...l, count: nc, amount: na, avg: Math.round(na / nc) }; }); return prev; } return [...prev, { keyword: loc, count: amt > 0 ? 1 : 0, amount: amt > 0 ? amt : 0, avg: amt > 0 ? amt : 0, isNew: true }]; }); }
        setSlipTxns(prev => [...prev, txn]);
        setSlipQueue(prev => prev.map((p, j) => j === i ? { ...p, status: "done", result: parsed } : p));
      } catch (err: any) { setSlipQueue(prev => prev.map((p, j) => j === i ? { ...p, status: "error", error: err.message } : p)); }
    }
    showToast(`✓ Processed ${files.length} slip(s). See Slips tab.`, "success");
  }, [locations, showToast]);

  const filtered = useMemo(() => {
    let base = locations;
    if (search) base = base.filter(l => l.keyword.toLowerCase().includes(search.toLowerCase()));
    if ((dateFrom || dateTo) && (excelTxns.length || slipTxns.length)) {
      base = base.map(l => {
        const ex = excelTxns.filter(t => t.location === l.keyword && (!dateFrom || t.date >= dateFrom) && (!dateTo || t.date <= dateTo));
        const sl = slipTxns.filter(t => t.location === l.keyword && (!dateFrom || t.date >= dateFrom) && (!dateTo || t.date <= dateTo));
        const all = [...ex, ...sl];
        return { ...l, count: all.length, amount: all.reduce((s, t) => s + t.amount, 0), avg: all.length ? Math.round(all.reduce((s, t) => s + t.amount, 0) / all.length) : 0 };
      }).filter(l => l.count > 0);
    }
    return [...base].sort((a, b) => sortBy === "keyword" ? a.keyword.localeCompare(b.keyword) : (b as any)[sortBy] - (a as any)[sortBy]);
  }, [locations, search, sortBy, dateFrom, dateTo, excelTxns, slipTxns]);

  const totals = useMemo(() => ({ locs: filtered.length, txns: filtered.reduce((s, l) => s + l.count, 0), amount: filtered.reduce((s, l) => s + l.amount, 0), slips: slipTxns.length, slipAmt: slipTxns.reduce((s, t) => s + t.amount, 0) }), [filtered, slipTxns]);
  const top10 = useMemo(() => [...filtered].sort((a, b) => (b as any)[chartMetric] - (a as any)[chartMetric]).slice(0, 10), [filtered, chartMetric]);
  const pieData = useMemo(() => { const s = [...filtered].sort((a, b) => b.amount - a.amount); const top = s.slice(0, 8), rest = s.slice(8).reduce((a, l) => a + l.amount, 0); if (rest > 0) top.push({ keyword: "Others", amount: rest } as any); return top; }, [filtered]);

  const PAGES = [["dashboard", "📊 Dashboard"], ["table", "📍 Locations"], ["slips", "🧾 Slips" + (slipTxns.length ? ` (${slipTxns.length})` : "")]];

  return (
    <>
      <div style={{ minHeight: "100vh", background: "#021f0f", paddingBottom: "env(safe-area-inset-bottom)" }}>

        {/* ── HEADER ──────────────────────────────────────────────────────── */}
        <header style={{ background: "linear-gradient(135deg,#052e16 0%,#064e22 60%,#065f46 100%)", borderBottom: "1px solid #166534", padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60, position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 24px #000a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(135deg,#16a34a,#4ade80)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: "0 2px 12px #16a34a66", flexShrink: 0 }}>🌾</div>
            <div>
              <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: "#f0fdf4", lineHeight: 1.2 }}>AgriPayments KA</div>
              <div className="header-title-sub" style={{ fontSize: 10, color: "#86efac", fontFamily: "DM Mono,monospace", letterSpacing: .5 }}>NEFT · RTGS · UTR TRACKER</div>
            </div>
          </div>
          {/* Desktop nav */}
          <nav className="desktop-nav" style={{ gap: 4, display: "flex" }}>
            {PAGES.map(([id, label]) => (
              <button key={id} onClick={() => setPage(id)} className="bh" style={{ padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "DM Sans,sans-serif", fontSize: 13, fontWeight: 500, background: page === id ? "#16a34a" : "transparent", color: page === id ? "#f0fdf4" : "#86efac", transition: "all .2s", ...(page !== id ? { outline: "1px solid #166534" } : {}) }}>{label}</button>
            ))}
          </nav>
          {/* Mobile filter toggle */}
          <button className="mobile-toolbar-toggle" onClick={() => setFiltersOpen(v => !v)} style={{ display: "none", alignItems: "center", gap: 6, background: filtersOpen ? "#16a34a" : "transparent", border: "1px solid #166534", borderRadius: 8, color: "#86efac", padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
            ⚙️ {filtersOpen ? "Close" : "Filters"}
          </button>
        </header>

        {/* ── MOBILE FILTERS PANEL ────────────────────────────────────────── */}
        {filtersOpen && (
          <div className="mobile-filters-panel" style={{ background: "#052e16", borderBottom: "1px solid #166534", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10, animation: "fadeIn .2s ease" }}>
            {/* Upload row */}
            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", background: "#16a34a", color: "#f0fdf4", borderRadius: 9, padding: "10px 8px", fontSize: 12, fontWeight: 600, opacity: uploading ? .5 : 1 }}>
                📊 {uploading ? (uploadMsg || "…") : "Excel"}
                <input ref={excelRef} type="file" accept=".xlsx,.xls" onChange={handleExcel} style={{ display: "none" }} disabled={uploading} />
              </label>
              <label style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", background: "#d97706", color: "#1c1917", borderRadius: 9, padding: "10px 8px", fontSize: 12, fontWeight: 700 }}>
                📄 Slips
                <input ref={slipRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple onChange={handleSlips} style={{ display: "none" }} />
              </label>
            </div>
            {/* Search */}
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#4ade80", fontSize: 14 }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search location…" style={{ width: "100%", paddingLeft: 32, paddingRight: 10, height: 40, background: "#064e22", border: "1px solid #166534", borderRadius: 8, color: "#d1fae5", fontSize: 14, outline: "none" }} />
            </div>
            {/* Date range */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: "#86efac", fontFamily: "DM Mono,monospace", marginBottom: 4 }}>FROM</div>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: "100%", height: 40, padding: "0 10px", background: "#064e22", border: "1px solid #166534", borderRadius: 8, color: "#d1fae5", fontSize: 13, outline: "none" }} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#86efac", fontFamily: "DM Mono,monospace", marginBottom: 4 }}>TO</div>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: "100%", height: 40, padding: "0 10px", background: "#064e22", border: "1px solid #166534", borderRadius: 8, color: "#d1fae5", fontSize: 13, outline: "none" }} />
              </div>
            </div>
            {/* Sort + export row */}
            <div style={{ display: "flex", gap: 8 }}>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ flex: 1, height: 40, padding: "0 10px", background: "#064e22", border: "1px solid #166534", borderRadius: 8, color: "#d1fae5", fontSize: 13, outline: "none" }}>
                <option value="amount">Amount ↓</option>
                <option value="count">Txns ↓</option>
                <option value="avg">Avg ↓</option>
                <option value="keyword">Name A-Z</option>
              </select>
              <button onClick={() => exportUPTO(SHEET_DATA, locations.filter(l => !SHEET_DATA[l.keyword as keyof typeof SHEET_DATA]), slipTxns)} style={{ flex: 1, height: 40, background: "#7c3aed", border: "1px solid #a78bfa", borderRadius: 8, color: "#ede9fe", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⬇ UPTO</button>
              <button onClick={() => exportToExcel(filtered, excelTxns, slipTxns, dateFrom, dateTo)} style={{ flex: 1, height: 40, background: "#065f46", border: "1px solid #0d9488", borderRadius: 8, color: "#99f6e4", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⬇ Excel</button>
            </div>
            {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(""); setDateTo("") }} style={{ width: "100%", height: 36, background: "#3f0f0f", border: "1px solid #7f1d1d", borderRadius: 8, color: "#fca5a5", fontSize: 12, cursor: "pointer" }}>✕ Clear Date Filter</button>}
          </div>
        )}

        {/* ── DESKTOP TOOLBAR ─────────────────────────────────────────────── */}
        <div className="desktop-toolbar" style={{ display: "flex", background: "#052e16", borderBottom: "1px solid #166534", padding: "12px 24px", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <label className="bh" style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", background: "#16a34a", color: "#f0fdf4", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 600, flexShrink: 0, opacity: uploading ? .5 : 1 }}>
            📊 {uploading ? (uploadMsg || "Processing…") : "Upload Excel"}
            <input ref={excelRef} type="file" accept=".xlsx,.xls" onChange={handleExcel} style={{ display: "none" }} disabled={uploading} />
          </label>
          <label className="bh" style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", background: "#d97706", color: "#1c1917", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
            📄 Upload Slips (PDF/IMG)
            <input ref={slipRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple onChange={handleSlips} style={{ display: "none" }} />
          </label>
          <div style={{ width: 1, height: 28, background: "#166534" }} />
          <div style={{ position: "relative", flex: "1 1 140px" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#4ade80", fontSize: 13 }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search location…" style={{ width: "100%", paddingLeft: 30, paddingRight: 8, height: 36, background: "#064e22", border: "1px solid #166534", borderRadius: 8, color: "#d1fae5", fontSize: 13, outline: "none" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span style={{ color: "#86efac", fontSize: 11, fontFamily: "DM Mono,monospace" }}>FROM</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ height: 36, padding: "0 8px", background: "#064e22", border: "1px solid #166534", borderRadius: 8, color: "#d1fae5", fontSize: 13, outline: "none" }} />
            <span style={{ color: "#86efac", fontSize: 11, fontFamily: "DM Mono,monospace" }}>TO</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ height: 36, padding: "0 8px", background: "#064e22", border: "1px solid #166534", borderRadius: 8, color: "#d1fae5", fontSize: 13, outline: "none" }} />
            {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(""); setDateTo("") }} style={{ height: 36, padding: "0 8px", background: "#3f0f0f", border: "1px solid #7f1d1d", borderRadius: 8, color: "#fca5a5", fontSize: 12, cursor: "pointer" }}>✕</button>}
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ height: 36, padding: "0 10px", background: "#064e22", border: "1px solid #166534", borderRadius: 8, color: "#d1fae5", fontSize: 13, outline: "none", cursor: "pointer" }}>
            <option value="amount">Sort: Amount</option>
            <option value="count">Sort: Txns</option>
            <option value="avg">Sort: Avg</option>
            <option value="keyword">Sort: Name</option>
          </select>
          <button className="bh" onClick={() => exportUPTO(SHEET_DATA, locations.filter(l => !SHEET_DATA[l.keyword as keyof typeof SHEET_DATA]), slipTxns)} style={{ height: 36, padding: "0 14px", background: "#7c3aed", border: "1px solid #a78bfa", borderRadius: 8, color: "#ede9fe", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>⬇ Download UPTO Excel</button>
          <button className="bh" onClick={() => exportToExcel(filtered, excelTxns, slipTxns, dateFrom, dateTo)} style={{ height: 36, padding: "0 14px", background: "#065f46", border: "1px solid #0d9488", borderRadius: 8, color: "#99f6e4", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>⬇ Export Excel</button>
        </div>

        <main style={{ maxWidth: 1380, margin: "0 auto", padding: "16px 12px 80px" }}>

          {/* NEW LOCATIONS BANNER */}
          {newLocations.length > 0 && (
            <div style={{ background: "linear-gradient(135deg,#713f12,#92400e)", border: "1px solid #d97706", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span>🆕</span>
              <span style={{ fontWeight: 600, color: "#fef3c7", fontSize: 13 }}>New locations:</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {newLocations.map(l => <span key={l.keyword} style={{ background: "#d97706", color: "#1c1917", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700, fontFamily: "DM Mono,monospace" }}>{l.keyword}</span>)}
              </div>
              <button onClick={() => setNewLocations([])} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#fbbf24", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
          )}

          {/* KPI CARDS */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Total Disbursed", value: SHORT(totals.amount), icon: "💰", sub: `${totals.locs} locations`, color: "#4ade80", warn: false },
              { label: "Transactions", value: totals.txns.toLocaleString("en-IN"), icon: "📋", sub: "NEFT + RTGS", color: "#86efac", warn: false },
              { label: "Slip Txns", value: totals.slips, icon: "🧾", sub: SHORT(totals.slipAmt), color: "#fbbf24", warn: totals.slips > 0 },
              { label: "Locations", value: totals.locs, icon: "📍", sub: "Active districts", color: "#bbf7d0", warn: false },
            ].map((k, i) => (
              <div key={i} style={{ background: "linear-gradient(135deg,#052e16,#064e22)", border: `1px solid ${k.warn ? "#d97706" : "#166534"}`, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "#86efac", fontWeight: 500 }}>{k.label}</span>
                  <span style={{ fontSize: 18 }}>{k.icon}</span>
                </div>
                <div style={{ fontSize: 22, fontFamily: "'DM Serif Display',serif", color: k.color, lineHeight: 1 }}>{k.value}</div>
                <div style={{ fontSize: 10, color: "#4ade8099", fontFamily: "DM Mono,monospace" }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* ═══ DASHBOARD ═══ */}
          {page === "dashboard" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Bar chart */}
              <div style={{ background: "#052e16", border: "1px solid #166534", borderRadius: 12, padding: "14px 12px 8px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: "#f0fdf4" }}>Top 10 Locations</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[["amount", "₹"], ["count", "#"]].map(([v, l]) => (
                      <button key={v} onClick={() => setChartMetric(v as any)} style={{ padding: "3px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, background: chartMetric === v ? "#16a34a" : "#064e22", color: chartMetric === v ? "#f0fdf4" : "#86efac", outline: chartMetric !== v ? "1px solid #166534" : "none" }}>{l}</button>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={top10} margin={{ top: 0, right: 4, bottom: 28, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#166534" vertical={false} />
                    <XAxis dataKey="keyword" tick={{ fill: "#86efac", fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tick={{ fill: "#4ade80", fontSize: 10 }} tickFormatter={v => chartMetric === "amount" ? SHORT(v) : v} width={40} />
                    <Tooltip content={<Tip />} />
                    <Bar dataKey={chartMetric} name={chartMetric === "amount" ? "Total Amount" : "Txn Count"} radius={[4, 4, 0, 0]}>
                      {top10.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Monthly trend */}
              <div style={{ background: "#052e16", border: "1px solid #166534", borderRadius: 12, padding: "14px 12px 8px" }}>
                <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: "#f0fdf4", marginBottom: 10 }}>Monthly Trend</div>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={monthly} margin={{ top: 0, right: 4, bottom: 18, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#166534" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#86efac", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#4ade80", fontSize: 10 }} tickFormatter={SHORT} width={40} />
                    <Tooltip content={<Tip />} />
                    <Line type="monotone" dataKey="amount" name="Total Amount" stroke="#4ade80" strokeWidth={2} dot={{ fill: "#16a34a", r: 3 }} activeDot={{ r: 5, fill: "#86efac" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Pie */}
              <div style={{ background: "#052e16", border: "1px solid #166534", borderRadius: 12, padding: "14px 12px 8px" }}>
                <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: "#f0fdf4", marginBottom: 10 }}>Amount Share</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} dataKey="amount" nameKey="keyword" cx="50%" cy="50%" outerRadius={75} labelLine={false} label={({ keyword, percent }) => `${keyword} ${(percent * 100).toFixed(0)}%`}>
                      {pieData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => SHORT(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Locations grid */}
              <div style={{ background: "#052e16", border: "1px solid #166534", borderRadius: 12, padding: "14px 12px" }}>
                <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: "#f0fdf4", marginBottom: 10 }}>All Locations</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8, maxHeight: 300, overflowY: "auto" }}>
                  {filtered.map(l => {
                    const hasSlips = slipTxns.some(t => t.location === l.keyword);
                    return (
                      <div key={l.keyword} onClick={() => setPage("table")} style={{ background: l.isNew ? "linear-gradient(135deg,#713f12,#78350f)" : "#064e22", border: `1px solid ${l.isNew ? "#d97706" : hasSlips ? "#0d9488" : "#166534"}`, borderRadius: 9, padding: "9px 11px", cursor: "pointer" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                          <span style={{ fontSize: 10, fontFamily: "DM Mono,monospace", color: "#4ade80", fontWeight: 600 }}>{l.keyword}</span>
                          <div style={{ display: "flex", gap: 3 }}>
                            {l.isNew && <span style={{ fontSize: 8, background: "#d97706", color: "#1c1917", borderRadius: 3, padding: "1px 4px", fontWeight: 700 }}>NEW</span>}
                            {hasSlips && <span style={{ fontSize: 8, background: "#0d9488", color: "#f0fdf4", borderRadius: 3, padding: "1px 4px", fontWeight: 700 }}>+S</span>}
                          </div>
                        </div>
                        <div style={{ fontSize: 14, fontFamily: "'DM Serif Display',serif", color: "#f0fdf4" }}>{SHORT(l.amount)}</div>
                        <div style={{ fontSize: 10, color: "#86efac99", marginTop: 1 }}>{l.count} txns</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ═══ TABLE ═══ */}
          {page === "table" && (
            <div style={{ background: "#052e16", border: "1px solid #166534", borderRadius: 12, overflow: "hidden" }}>
              {/* Mobile card list */}
              <div style={{ display: "block" }}>
                {filtered.map((l, i) => {
                  const pct = totals.amount ? (l.amount / totals.amount * 100).toFixed(1) : 0;
                  const locSlips = slipTxns.filter(t => t.location === l.keyword);
                  return (
                    <div key={l.keyword} style={{ padding: "12px 14px", borderBottom: "1px solid #0d3320", background: i % 2 === 0 ? "transparent" : "#042415" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontFamily: "DM Mono,monospace", fontWeight: 700, color: "#86efac", fontSize: 14 }}>{l.keyword}</span>
                          {l.isNew && <span style={{ fontSize: 9, background: "#78350f", color: "#fde68a", borderRadius: 4, padding: "2px 6px", fontWeight: 700 }}>NEW</span>}
                          {locSlips.length > 0 && <span style={{ fontSize: 9, background: "#065f46", color: "#6ee7b7", borderRadius: 4, padding: "2px 6px", fontWeight: 700 }}>SLIP</span>}
                        </div>
                        <span style={{ fontFamily: "DM Mono,monospace", fontWeight: 700, color: "#4ade80", fontSize: 14 }}>{INR(l.amount)}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
                        <div style={{ background: "#064e22", borderRadius: 6, padding: "5px 8px" }}>
                          <div style={{ fontSize: 9, color: "#86efac99", marginBottom: 1 }}>TRANSACTIONS</div>
                          <div style={{ fontSize: 13, fontFamily: "DM Mono,monospace", color: "#d1fae5", fontWeight: 600 }}>{l.count}</div>
                        </div>
                        <div style={{ background: "#064e22", borderRadius: 6, padding: "5px 8px" }}>
                          <div style={{ fontSize: 9, color: "#86efac99", marginBottom: 1 }}>AVG AMOUNT</div>
                          <div style={{ fontSize: 12, fontFamily: "DM Mono,monospace", color: "#86efac" }}>{SHORT(l.avg)}</div>
                        </div>
                        <div style={{ background: "#064e22", borderRadius: 6, padding: "5px 8px" }}>
                          <div style={{ fontSize: 9, color: "#86efac99", marginBottom: 1 }}>SLIPS</div>
                          <div style={{ fontSize: 13, fontFamily: "DM Mono,monospace", color: "#fbbf24", fontWeight: 600 }}>{locSlips.length || "—"}</div>
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 5, background: "#0d3320", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "#16a34a", borderRadius: 3 }} />
                        </div>
                        <span style={{ color: "#86efac", fontSize: 11, fontFamily: "DM Mono,monospace", width: 32, textAlign: "right" }}>{pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Footer total */}
              <div style={{ background: "#064e22", borderTop: "2px solid #166534", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: "DM Mono,monospace", fontWeight: 700, color: "#4ade80", fontSize: 12 }}>TOTAL ({filtered.length} locations)</span>
                <span style={{ fontFamily: "DM Mono,monospace", fontWeight: 700, color: "#4ade80", fontSize: 14 }}>{INR(totals.amount)}</span>
              </div>
            </div>
          )}

          {/* ═══ SLIPS ═══ */}
          {page === "slips" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {slipQueue.length > 0 && (
                <div style={{ background: "#052e16", border: "1px solid #166534", borderRadius: 12, padding: "14px" }}>
                  <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: "#f0fdf4", marginBottom: 12 }}>🤖 AI Processing Queue</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {slipQueue.map((p, i) => (
                      <div key={i} style={{ background: "#064e22", border: `1px solid ${p.status === "error" ? "#dc2626" : p.status === "done" ? "#16a34a" : "#166534"}`, borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: p.result ? 8 : 0 }}>
                          <span style={{ fontSize: 18, flexShrink: 0 }}>{p.status === "queued" ? "⏳" : p.status === "processing" ? "⚙️" : p.status === "done" ? "✅" : "❌"}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: "#d1fae5", fontWeight: 500, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                            <div style={{ color: "#86efac99", fontSize: 10, fontFamily: "DM Mono,monospace" }}>
                              {p.status === "processing" ? "Sending to Gemini AI…" : p.status === "queued" ? "In queue…" : p.status === "error" ? `Error: ${p.error}` : "Extracted successfully"}
                            </div>
                          </div>
                          {p.result && <button onClick={() => setDetailModal(p)} style={{ background: "#0f172a", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer", flexShrink: 0 }}>Details</button>}
                        </div>
                        {p.result && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ background: p.result.location === "UNCLASSIFIED" ? "#7f1d1d" : "#16a34a", color: "#f0fdf4", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700, fontFamily: "DM Mono,monospace" }}>{p.result.location || "UNCLASSIFIED"}</span>
                            <span style={{ background: "#065f46", color: "#6ee7b7", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontFamily: "DM Mono,monospace" }}>{INR(p.result.amount || 0)}</span>
                            <span style={{ background: "#064e22", color: "#86efac", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontFamily: "DM Mono,monospace" }}>{p.result.date || "—"}</span>
                            <span style={{ background: p.result.confidence === "high" ? "#14532d" : p.result.confidence === "medium" ? "#713f12" : "#3f0f0f", color: p.result.confidence === "high" ? "#4ade80" : p.result.confidence === "medium" ? "#fbbf24" : "#fca5a5", borderRadius: 5, padding: "2px 8px", fontSize: 10, fontFamily: "DM Mono,monospace" }}>{(p.result.confidence || "?").toUpperCase()}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ background: "#052e16", border: "1px solid #166534", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "12px 14px", borderBottom: "1px solid #166534", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: "#f0fdf4" }}>🧾 Slip Transactions ({slipTxns.length})</div>
                  <div style={{ fontSize: 12, color: "#fbbf24", fontFamily: "DM Mono,monospace" }}>{INR(slipTxns.reduce((s, t) => s + t.amount, 0))}</div>
                </div>
                {slipTxns.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "48px 16px", color: "#4ade8066" }}>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>📄</div>
                    <div style={{ fontFamily: "DM Mono,monospace", fontSize: 12 }}>No slips uploaded yet.</div>
                    <div style={{ fontSize: 11, color: "#4ade8044", marginTop: 4 }}>Tap ⚙️ Filters → Slips to upload PDFs or images.</div>
                  </div>
                ) : (
                  <div>
                    {slipTxns.map((t, i) => (
                      <div key={i} style={{ padding: "11px 14px", borderBottom: "1px solid #0d3320", background: i % 2 === 0 ? "transparent" : "#042415" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ background: t.location === "UNCLASSIFIED" ? "#7f1d1d" : "#14532d", color: t.location === "UNCLASSIFIED" ? "#fca5a5" : "#4ade80", fontFamily: "DM Mono,monospace", fontWeight: 700, borderRadius: 5, padding: "2px 8px", fontSize: 11 }}>{t.location}</span>
                          <span style={{ color: "#fbbf24", fontFamily: "DM Mono,monospace", fontWeight: 700, fontSize: 13 }}>{INR(t.amount)}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 11 }}>
                          <div style={{ color: "#86efac99" }}><span style={{ color: "#4ade8066" }}>UTR </span>{t.utr || "—"}</div>
                          <div style={{ color: "#86efac99" }}><span style={{ color: "#4ade8066" }}>Date </span>{t.date || "—"}</div>
                          <div style={{ color: "#86efac99" }}><span style={{ color: "#4ade8066" }}>Type </span>{t.txtype || "—"}</div>
                          <div style={{ color: "#86efac99" }}><span style={{ color: "#4ade8066" }}>Conf </span>
                            <span style={{ color: t.confidence === "high" ? "#4ade80" : t.confidence === "medium" ? "#fbbf24" : "#fca5a5", fontWeight: 600 }}>{(t.confidence || "?").toUpperCase()}</span>
                          </div>
                        </div>
                        {t.sender && <div style={{ fontSize: 10, color: "#86efac66", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.sourceFile}</div>}
                      </div>
                    ))}
                    <div style={{ background: "#064e22", borderTop: "2px solid #166534", padding: "11px 14px", display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontFamily: "DM Mono,monospace", color: "#fbbf24", fontWeight: 700, fontSize: 12 }}>TOTAL ({slipTxns.length})</span>
                      <span style={{ fontFamily: "DM Mono,monospace", color: "#fbbf24", fontWeight: 700 }}>{INR(slipTxns.reduce((s, t) => s + t.amount, 0))}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── MOBILE BOTTOM NAV ───────────────────────────────────────────────── */}
      <nav className="mobile-bottom-nav" style={{ display: "flex", position: "fixed", bottom: 0, left: 0, right: 0, background: "#052e16", borderTop: "1px solid #166534", padding: "8px 0 calc(8px + env(safe-area-inset-bottom))", zIndex: 200, justifyContent: "space-around" }}>
        {PAGES.map(([id, label]) => {
          const icon = id === "dashboard" ? "📊" : id === "table" ? "📍" : "🧾";
          const shortLabel = id === "dashboard" ? "Dashboard" : id === "table" ? "Locations" : "Slips";
          return (
            <button key={id} onClick={() => { setPage(id); setFiltersOpen(false); }} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, background: "none", border: "none", cursor: "pointer", padding: "4px 12px", borderRadius: 8, backgroundColor: page === id ? "#16a34a22" : "transparent" }}>
              <span style={{ fontSize: 20 }}>{icon}</span>
              <span style={{ fontSize: 10, color: page === id ? "#4ade80" : "#86efac99", fontWeight: page === id ? 600 : 400 }}>{shortLabel}</span>
              {id === "slips" && slipTxns.length > 0 && <span style={{ position: "absolute", top: 6, background: "#d97706", color: "#1c1917", borderRadius: 99, fontSize: 9, padding: "1px 5px", fontWeight: 700, marginLeft: 18 }}>{slipTxns.length}</span>}
            </button>
          );
        })}
      </nav>

      {/* DETAIL MODAL */}
      {detailModal && (
        <div onClick={() => setDetailModal(null)} style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#052e16", border: "1px solid #166534", borderRadius: "16px 16px 0 0", padding: "20px 20px calc(20px + env(safe-area-inset-bottom))", width: "100%", maxWidth: 600, maxHeight: "80vh", overflowY: "auto", animation: "slideIn .3s ease" }}>
            <div style={{ width: 40, height: 4, background: "#166534", borderRadius: 2, margin: "0 auto 16px" }} />
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: "#f0fdf4", marginBottom: 14 }}>Slip Extraction Detail</div>
            <div style={{ fontSize: 11, color: "#86efac", fontFamily: "DM Mono,monospace", marginBottom: 4 }}>FILE</div>
            <div style={{ color: "#d1fae5", marginBottom: 14, fontSize: 12, wordBreak: "break-all" }}>{detailModal.name}</div>
            {detailModal.result && Object.entries(detailModal.result).map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 10, marginBottom: 8, borderBottom: "1px solid #0d3320", paddingBottom: 8 }}>
                <div style={{ fontFamily: "DM Mono,monospace", fontSize: 10, color: "#4ade80", width: 90, flexShrink: 0, paddingTop: 1 }}>{k.toUpperCase()}</div>
                <div style={{ color: "#d1fae5", fontSize: 12, wordBreak: "break-all", lineHeight: 1.5 }}>{String(v || "—")}</div>
              </div>
            ))}
            <button onClick={() => setDetailModal(null)} style={{ marginTop: 12, width: "100%", padding: "12px", background: "#16a34a", border: "none", borderRadius: 10, color: "#f0fdf4", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Close</button>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: "fixed", bottom: 80, left: 12, right: 12, zIndex: 9999, background: toast.type === "error" ? "#7f1d1d" : toast.type === "warn" ? "#78350f" : "#14532d", border: `1px solid ${toast.type === "error" ? "#dc2626" : toast.type === "warn" ? "#d97706" : "#16a34a"}`, borderRadius: 12, padding: "12px 16px", color: "#f0fdf4", fontSize: 13, boxShadow: "0 8px 32px #000a", lineHeight: 1.6, animation: "slideIn .3s ease" }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}
