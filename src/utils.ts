export const INR = (n: number | string) => "₹" + Number(n).toLocaleString("en-IN");
export const SHORT = (n: number) => n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : `₹${Number(n).toLocaleString("en-IN")}`;
export const PALETTE = ["#16a34a", "#15803d", "#22c55e", "#4ade80", "#86efac", "#14532d", "#bbf7d0", "#166534", "#365314", "#f0fdf4"];

export function classifyRows(rows: any[][], headers: string[]) {
  const idx = (k: string) => headers.findIndex(h => String(h || "").trim().toUpperCase() === k.toUpperCase());
  const AMT = idx("TXN_AMOUNT_IN_RS"), F72 = idx("FIELD72FULLTEXT"), DATE = idx("ENTRYDATE"),
    UTR = idx("UTR"), TID = idx("TRANID"), TYPE = idx("TXNTYPE"),
    SNDR = idx("SENDERACCNAME"), RCVR = idx("RECEIVERACCNAME"), STAT = idx("STATUS");
  
  const get = (row: any[], i: number) => i >= 0 && i < row.length ? row[i] : "";
  const locMap: any = {}, monthMap: any = {}, txnList: any[] = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]; if (!row) continue;
    const amt = parseFloat(get(row, AMT)) || 0; if (!amt) continue;
    const f72 = String(get(row, F72) || "");
    const utr = String(get(row, UTR) || ""), tranid = String(get(row, TID) || "");
    const txtype = String(get(row, TYPE) || ""), sender = String(get(row, SNDR) || "");
    const receiver = String(get(row, RCVR) || ""), status = String(get(row, STAT) || "");
    const rawDate = String(get(row, DATE) || "");
    const dateStr = rawDate.length === 8 ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : rawDate.slice(0, 10);
    const match = f72.match(/ASSISTANTDIRECTOROFAGRICULTURE([A-Z]+)/i);
    const loc = match ? match[1].toUpperCase() : "UNCLASSIFIED";
    const txn = { location: loc, amount: amt, date: dateStr, utr, tranid, txtype, sender, receiver, status, field72: f72, source: "excel" };
    txnList.push(txn);
    if (!locMap[loc]) locMap[loc] = { keyword: loc, count: 0, amount: 0 };
    locMap[loc].count++; locMap[loc].amount += amt;
    if (dateStr.length >= 7) {
      const ym = dateStr.slice(0, 7);
      if (!monthMap[ym]) monthMap[ym] = { count: 0, amount: 0 };
      monthMap[ym].count++; monthMap[ym].amount += amt;
    }
  }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const locations = Object.values(locMap).map((l: any) => ({ ...l, avg: l.count ? Math.round(l.amount / l.count) : 0 }));
  const monthly = Object.entries(monthMap).sort(([a], [b]) => a.localeCompare(b)).map(([ym, v]: [string, any]) => {
    const [y, m] = ym.split("-");
    return { month: `${MONTHS[+m - 1]} ${y}`, label: `${MONTHS[+m - 1]}\'${y.slice(2)}`, ...v };
  });
  return { locations, monthly, transactions: txnList };
}

export async function parseSlipWithClaude(base64Data: string, mediaType: string, knownLocations: string[]) {
  const locList = knownLocations.join(", ");
  const prompt = `You are analyzing an agricultural payment transaction slip (NEFT/RTGS/UTR) from Karnataka, India.
Extract these fields:
1. UTR number (transaction reference / UTR No / Ref No)
2. Transaction amount in rupees (number only, no commas/symbols)
3. Transaction date (YYYY-MM-DD format)
4. Sender name
5. Receiver name
6. Transaction type (NEFT, RTGS, IMPS, etc.)
7. Location: match to one of: ${locList}. Also check for "ASSISTANTDIRECTOROFAGRICULTURE[LOCATION]" patterns. If no match, return "UNCLASSIFIED".
8. Reference / Batch ID if visible.
Respond ONLY with valid JSON, no markdown:
{"utr":"","amount":0,"date":"","sender":"","receiver":"","txtype":"","location":"","reference":"","confidence":"high","rawText":"brief summary"}`;

  // Note: This uses a hypothetical endpoint or requires the actual Gemini API integration as per guidelines.
  // Since the original code used a direct fetch to Anthropic, I will adapt it to use Gemini if possible, 
  // but the user asked for an "exact app". However, I must follow the Gemini API guidelines.
  // I'll implement a placeholder that explains the requirement or attempts to use Gemini.
  // Actually, I'll implement it using Gemini as per the developer instructions.
  
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const model = "gemini-3-flash-preview";
  
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        inlineData: {
          mimeType: mediaType,
          data: base64Data
        }
      },
      {
        text: prompt
      }
    ],
    config: {
      responseMimeType: "application/json"
    }
  });

  const text = response.text || "{}";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

export async function exportUPTO(SHEET_DATA: any, extraLocations: any[], slipTxns: any[]) {
  if (!(window as any).XLSX) {
    await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  const XLSX = (window as any).XLSX; const wb = XLSX.utils.book_new();
  const summaryRows = JSON.parse(JSON.stringify(SHEET_DATA["SUMMARY"]));
  let totalCount = 0, totalAmt = 0;
  for (let i = 2; i < summaryRows.length; i++) { totalCount += (summaryRows[i][2] || 0); totalAmt += (summaryRows[i][3] || 0); }
  const existingKeywords = new Set(summaryRows.slice(1).map((r: any) => r[0]));
  const newFromSlips: any = {};
  slipTxns.forEach(t => { if (t.location === "UNCLASSIFIED") return; if (!newFromSlips[t.location]) newFromSlips[t.location] = { count: 0, amount: 0 }; newFromSlips[t.location].count++; newFromSlips[t.location].amount += t.amount; });
  extraLocations.forEach(l => {
    if (!existingKeywords.has(l.keyword)) {
      const sd = newFromSlips[l.keyword] || { count: 0, amount: 0 }; const cnt = l.count + sd.count, amt = l.amount + sd.amount;
      summaryRows.push([l.keyword, l.keyword, cnt, amt, cnt ? Math.round(amt / cnt * 100) / 100 : 0, "Added"]);
      totalCount += cnt; totalAmt += amt;
    } else {
      const sd = newFromSlips[l.keyword];
      if (sd) { const row = summaryRows.find((r: any) => r[0] === l.keyword); if (row) { row[2] = (row[2] || 0) + sd.count; row[3] = (row[3] || 0) + sd.amount; row[4] = row[2] ? Math.round(row[3] / row[2] * 100) / 100 : 0; } totalCount += sd.count; totalAmt += sd.amount; }
    }
  });
  summaryRows[1] = ["TOTAL", summaryRows[1][1], totalCount, totalAmt, totalCount ? Math.round(totalAmt / totalCount * 100) / 100 : 0, summaryRows[1][5] || ""];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "SUMMARY");
  const sheetOrder = Object.keys(SHEET_DATA).filter(k => k !== "SUMMARY");
  const slipByLoc: any = {}; slipTxns.forEach(t => { if (!slipByLoc[t.location]) slipByLoc[t.location] = []; slipByLoc[t.location].push(t); });
  for (const sheetName of sheetOrder) {
    const sheetRows = JSON.parse(JSON.stringify(SHEET_DATA[sheetName])); const headers = sheetRows[0];
    (slipByLoc[sheetName] || []).forEach((t: any) => {
      const nr = new Array(headers.length).fill(null);
      const set = (k: string, v: any) => { const i = headers.indexOf(k); if (i >= 0) nr[i] = v; };
      set("TXN_AMOUNT_IN_RS", t.amount); set("UTR", t.utr); set("TXNTYPE", t.txtype || "NEFT");
      set("ENTRYDATE", t.date ? t.date.replace(/-/g, "") : ""); set("VALUEDATE", t.date ? t.date.replace(/-/g, "") : "");
      set("SENDERACCNAME", t.sender || ""); set("RECEIVERACCNAME", t.receiver || ""); set("STATUS", "Completed");
      set("FIELD72FULLTEXT", `BATCHID:SLIP||ASSISTANTDIRECTOROFAGRICULTURE${sheetName}`); (nr as any).source = "SLIP";
      sheetRows.push(nr);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetRows), sheetName.slice(0, 31));
    delete slipByLoc[sheetName];
  }
  for (const [loc, slips] of Object.entries(slipByLoc)) {
    if (loc === "UNCLASSIFIED" || !(slips as any).length) continue;
    const headers = SHEET_DATA[sheetOrder[0]][0]; const newRows = [headers];
    (slips as any).forEach((t: any) => {
      const nr = new Array(headers.length).fill(null);
      const set = (k: string, v: any) => { const i = headers.indexOf(k); if (i >= 0) nr[i] = v; };
      set("TXN_AMOUNT_IN_RS", t.amount); set("UTR", t.utr); set("TXNTYPE", t.txtype || "NEFT");
      set("ENTRYDATE", t.date ? t.date.replace(/-/g, "") : ""); set("VALUEDATE", t.date ? t.date.replace(/-/g, "") : "");
      set("SENDERACCNAME", t.sender || ""); set("RECEIVERACCNAME", t.receiver || ""); set("STATUS", "Completed");
      set("FIELD72FULLTEXT", `BATCHID:SLIP||ASSISTANTDIRECTOROFAGRICULTURE${loc}`); (nr as any).source = "SLIP";
      newRows.push(nr);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(newRows), loc.slice(0, 31));
  }
  const now = new Date(); const MN = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  XLSX.writeFile(wb, `UPTO_${MN[now.getMonth()]}_FINAL.xlsx`);
}

export async function exportToExcel(filteredLocs: any[], excelTxns: any[], slipTxns: any[], dateFrom: string, dateTo: string) {
  if (!(window as any).XLSX) { await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  const XLSX = (window as any).XLSX; const wb = XLSX.utils.book_new();
  const filt = (t: any) => (!dateFrom || t.date >= dateFrom) && (!dateTo || t.date <= dateTo);
  const sr: any[][] = [["Location", "Excel Txns", "Excel Amount", "Slip Txns", "Slip Amount", "Grand Total", "Avg"]];
  let gt = 0, ga = 0;
  for (const l of filteredLocs) { const sl = slipTxns.filter(t => t.location === l.keyword && filt(t)); const sa = sl.reduce((s, t) => s + t.amount, 0); const grand = l.amount + sa; const tc = l.count + sl.length; sr.push([l.keyword, l.count, l.amount, sl.length, sa, grand, tc ? Math.round(grand / tc) : 0]); gt += tc; ga += grand; }
  sr.push([], [`TOTAL (${filteredLocs.length})`, gt, "", "", "", ga, ""]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sr), "SUMMARY");
  const slipRows: any[][] = [["Location", "UTR", "Date", "Amount", "Type", "Sender", "Receiver", "Reference", "Confidence", "Source File", "AI Summary"]];
  slipTxns.filter(filt).forEach(t => slipRows.push([t.location, t.utr, t.date, t.amount, t.txtype, t.sender, t.receiver, t.reference || "", t.confidence || "", t.sourceFile || "", t.rawText || ""]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(slipRows), "SLIP_EXCEPTIONS");
  const le: any = {}, ls: any = {}; excelTxns.forEach(t => { if (!le[t.location]) le[t.location] = []; le[t.location].push(t); }); slipTxns.forEach(t => { if (!ls[t.location]) ls[t.location] = []; ls[t.location].push(t); });
  const hdr = ["UTR", "TRAN ID", "Date", "Amount", "Type", "Sender", "Receiver", "Status", "Source", "FIELD72"];
  for (const l of filteredLocs) {
    const ex = (le[l.keyword] || []).filter(filt); const sl = (ls[l.keyword] || []).filter(filt);
    const combined = [...ex.map(t => [t.utr, t.tranid, t.date, t.amount, t.txtype, t.sender, t.receiver, t.status || "Completed", "EXCEL", t.field72 || ""]), ...sl.map(t => [t.utr, "", t.date, t.amount, t.txtype, t.sender, t.receiver, "Completed", "SLIP", t.rawText || ""])];
    if (!combined.length) continue;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hdr, ...combined]), l.keyword.slice(0, 31));
  }
  XLSX.writeFile(wb, `AgriPayments_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
