(() => {
  "use strict";

  const CATEGORIES = ["Feeds", "Bakuna", "Gamot", "Vitamins", "Rent", "Sahod", "Iba pa"];
  const LAST_BATCH_KEY = "exmon:lastBatch";
  const LAST_TAB_KEY = "exmon:lastTab";
  const TABS = ["gastos", "culled", "wingband"];
  const byNatural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });

  const $ = (id) => document.getElementById(id);
  const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
  const fmtPeso = (n) => peso.format(Number(n) || 0);
  const fmtDate = (d) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "—";
  const today = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const numOrNull = (v) => (v === "" || v == null ? null : Number(v));
  const textOrNull = (v) => (v && v.trim() ? v.trim() : null);

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // ---------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------
  const cfg = window.APP_CONFIG || {};
  const configured =
    cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && !cfg.SUPABASE_ANON_KEY.includes("YOUR-ANON-KEY");

  if (!configured || !window.supabase) {
    $("setup-view").hidden = false;
    return;
  }

  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const state = {
    user: null,
    batches: [],
    totals: {},        // batch_id -> total amount
    currentId: null,
    expenses: [],      // expenses of current batch
    people: [],        // mga pangalan ng gumastos (para sa suggestions)
    editingExpenseId: null,
    editingBatchId: null,
    culls: [],         // culled ng current batch
    wingbands: [],     // wingbands ng current batch
    editingCullId: null,
    editingWbId: null,
  };

  // ---------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------
  let toastTimer;
  function toast(msg, isError = false) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.toggle("error", isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), isError ? 5000 : 2200);
  }

  function fail(err, fallback = "May error. Subukan ulit.") {
    console.error(err);
    const msg = err?.message || fallback;
    if (/row-level security|permission denied/i.test(msg)) {
      toast("Walang permiso. Siguraduhing nasa allowed_emails ang email mo.", true);
    } else {
      toast(msg, true);
    }
  }

  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } finally { if (btn) btn.disabled = false; }
  }

  // ---------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------
  function showLogin() {
    $("app-view").hidden = true;
    $("login-view").hidden = false;
  }

  async function showApp(user) {
    state.user = user;
    $("login-view").hidden = true;
    $("app-view").hidden = false;
    $("user-email").textContent = user.email;
    $("exp-date").value = today();
    $("cull-date").value = today();
    const lastTab = store.get(LAST_TAB_KEY);
    setTab(TABS.includes(lastTab) ? lastTab : "gastos");
    await loadBatches();
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("login-error");
    err.hidden = true;
    await busy(e.submitter, async () => {
      const { data, error } = await db.auth.signInWithPassword({
        email: $("login-email").value.trim(),
        password: $("login-password").value,
      });
      if (error) {
        err.textContent = /invalid/i.test(error.message) ? "Mali ang email o password." : error.message;
        err.hidden = false;
        return;
      }
      $("login-password").value = "";
      await showApp(data.user);
    });
  });

  $("logout-btn").addEventListener("click", async () => {
    await db.auth.signOut();
    state.user = null;
    showLogin();
  });

  // ---------------------------------------------------------------
  // Batches
  // ---------------------------------------------------------------
  async function loadBatches() {
    const [b, t] = await Promise.all([
      db.from("batches").select("*").order("start_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }),
      db.from("expenses").select("batch_id, amount, paid_by"),
    ]);
    if (b.error) return fail(b.error);
    if (t.error) return fail(t.error);

    state.batches = b.data;
    state.totals = {};
    const names = new Set();
    for (const row of t.data) {
      state.totals[row.batch_id] = (state.totals[row.batch_id] || 0) + Number(row.amount);
      if (row.paid_by) names.add(row.paid_by);
    }
    setPeople(names);

    const ids = state.batches.map((x) => x.id);
    if (!ids.includes(state.currentId)) {
      const last = store.get(LAST_BATCH_KEY);
      state.currentId = ids.includes(last) ? last : ids[0] || null;
    }

    renderBatchSelect();
    renderOverview();
    await loadBatchData();
  }

  async function loadBatchData() {
    await Promise.all([loadExpenses(), loadCulls(), loadWingbands()]);
  }

  function setPeople(names) {
    state.people = [...names].sort((a, b) => a.localeCompare(b));
    $("people-list").innerHTML = state.people.map((n) => `<option value="${esc(n)}">`).join("");
  }

  function currentBatch() {
    return state.batches.find((b) => b.id === state.currentId) || null;
  }

  function renderBatchSelect() {
    const sel = $("batch-select");
    sel.innerHTML = state.batches
      .map((b) => `<option value="${esc(b.id)}">${esc(b.name)}${b.status === "closed" ? " (tapos na)" : ""}</option>`)
      .join("");
    sel.value = state.currentId || "";
    const has = state.batches.length > 0;
    $("no-batch").hidden = has;
    $("batch-content").hidden = !has;
    $("edit-batch-btn").hidden = !has;
    sel.disabled = !has;
  }

  function renderOverview() {
    const body = $("overview-body");
    if (!state.batches.length) {
      body.innerHTML = `<tr><td colspan="6" class="muted">Wala pang batch.</td></tr>`;
      return;
    }
    let grand = 0;
    body.innerHTML = state.batches
      .map((b) => {
        const total = state.totals[b.id] || 0;
        grand += total;
        const per = b.chick_count ? fmtPeso(total / b.chick_count) : "—";
        return `<tr data-id="${esc(b.id)}" class="${b.id === state.currentId ? "current" : ""}">
          <td>${esc(b.name)}</td>
          <td>${esc(b.batch_type)}</td>
          <td class="num">${b.chick_count ?? "—"}</td>
          <td class="num">${fmtPeso(total)}</td>
          <td class="num">${per}</td>
          <td><span class="status ${esc(b.status)}">${b.status === "closed" ? "Tapos na" : "Active"}</span></td>
        </tr>`;
      })
      .join("");
    body.parentElement.querySelector("tfoot")?.remove();
    body.insertAdjacentHTML(
      "afterend",
      `<tfoot><tr><td colspan="3">Kabuuan</td><td class="num">${fmtPeso(grand)}</td><td colspan="2"></td></tr></tfoot>`
    );
  }

  $("overview-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    selectBatch(tr.dataset.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("batch-select").addEventListener("change", (e) => selectBatch(e.target.value));

  async function selectBatch(id) {
    state.currentId = id;
    store.set(LAST_BATCH_KEY, id);
    $("batch-select").value = id;
    resetExpenseForm();
    resetCullForm();
    resetWbForm();
    renderOverview();
    await loadBatchData();
  }

  // Batch dialog
  const dlg = $("batch-dialog");

  function openBatchDialog(batch) {
    state.editingBatchId = batch?.id || null;
    $("batch-dialog-title").textContent = batch ? "I-edit ang Batch" : "Bagong Batch";
    $("batch-name").value = batch?.name || "";
    $("batch-type").value = batch?.batch_type || "Early Bird";
    $("batch-status").value = batch?.status || "active";
    $("batch-start").value = batch?.start_date || today();
    $("batch-chicks").value = batch?.chick_count ?? "";
    $("batch-notes").value = batch?.notes || "";
    $("batch-delete").hidden = !batch;
    dlg.showModal();
    $("batch-name").focus();
  }

  $("new-batch-btn").addEventListener("click", () => openBatchDialog(null));
  document.querySelector('[data-action="new-batch"]').addEventListener("click", () => openBatchDialog(null));
  $("edit-batch-btn").addEventListener("click", () => openBatchDialog(currentBatch()));
  $("batch-cancel").addEventListener("click", () => dlg.close());

  $("batch-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = {
      name: $("batch-name").value.trim(),
      batch_type: $("batch-type").value,
      status: $("batch-status").value,
      start_date: $("batch-start").value || null,
      chick_count: numOrNull($("batch-chicks").value),
      notes: textOrNull($("batch-notes").value),
    };
    await busy(e.submitter, async () => {
      const q = state.editingBatchId
        ? db.from("batches").update(row).eq("id", state.editingBatchId).select().single()
        : db.from("batches").insert(row).select().single();
      const { data, error } = await q;
      if (error) return fail(error);
      dlg.close();
      state.currentId = data.id;
      store.set(LAST_BATCH_KEY, data.id);
      toast(state.editingBatchId ? "Na-update ang batch." : "Nagawa ang batch.");
      await loadBatches();
    });
  });

  $("batch-delete").addEventListener("click", async () => {
    const b = currentBatch();
    if (!b) return;
    const count = state.expenses.length;
    const ok = confirm(
      `Burahin ang batch na "${b.name}"?` +
        (count || state.culls.length || state.wingbands.length
          ? `\n\nKasama ring mabubura ang lahat ng gastos (${count}), culled (${state.culls.length}) at wingband (${state.wingbands.length}) ng batch na ito. Hindi na ito maibabalik.`
          : "")
    );
    if (!ok) return;
    const { error } = await db.from("batches").delete().eq("id", b.id);
    if (error) return fail(error);
    dlg.close();
    state.currentId = null;
    toast("Nabura ang batch.");
    await loadBatches();
  });

  // ---------------------------------------------------------------
  // Expenses
  // ---------------------------------------------------------------
  async function loadExpenses() {
    if (!state.currentId) {
      state.expenses = [];
      return;
    }
    const { data, error } = await db
      .from("expenses")
      .select("*")
      .eq("batch_id", state.currentId)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) return fail(error);
    state.expenses = data;
    renderSummary();
    renderExpenses();
  }

  function renderSummary() {
    const b = currentBatch();
    const sums = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
    let total = 0;
    for (const e of state.expenses) {
      const a = Number(e.amount);
      total += a;
      sums[e.category] = (sums[e.category] || 0) + a;
    }
    $("sum-total").textContent = fmtPeso(total);
    for (const c of CATEGORIES) $("sum-" + c).textContent = fmtPeso(sums[c]);

    const meta = [];
    if (b?.batch_type) meta.push(b.batch_type);
    if (b?.start_date) meta.push("Simula " + fmtDate(b.start_date));
    if (b?.chick_count) meta.push(`${b.chick_count.toLocaleString()} sisiw · ${fmtPeso(total / b.chick_count)} bawat sisiw`);
    $("sum-meta").textContent = meta.join(" · ");

    // keep overview totals in sync
    state.totals[state.currentId] = total;

    // gastos bawat tao
    const perPerson = {};
    for (const e of state.expenses) {
      const who = e.paid_by || "Hindi nakalagay";
      perPerson[who] = (perPerson[who] || 0) + Number(e.amount);
    }
    const entries = Object.entries(perPerson).sort((a, b) => b[1] - a[1]);
    const hasNames = state.expenses.some((e) => e.paid_by);
    $("people-summary").hidden = !hasNames;
    $("people-chips").innerHTML = entries
      .map(([who, amt]) => `<div class="chip${who === "Hindi nakalagay" ? " muted-chip" : ""}">
          <span class="avatar">${esc(who.charAt(0).toUpperCase())}</span>
          <span class="who">${esc(who)}</span>
          <span class="amt">${fmtPeso(amt)}</span>
        </div>`)
      .join("");

    // filter ng tao
    const sel = $("filter-person");
    const keep = sel.value;
    const inBatch = [...new Set(state.expenses.map((e) => e.paid_by).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = `<option value="">Lahat ng tao</option>` + inBatch.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
    sel.value = inBatch.includes(keep) ? keep : "";
    sel.hidden = inBatch.length === 0;
  }

  function renderExpenses() {
    const filter = $("filter-category").value;
    const person = $("filter-person").value;
    const rows = state.expenses.filter((e) => (!filter || e.category === filter) && (!person || e.paid_by === person));
    $("expense-empty").hidden = rows.length > 0;
    $("expense-empty").textContent = state.expenses.length
      ? "Walang gastos na tugma sa filter."
      : "Wala pang gastos na naka-input.";
    $("expense-list").innerHTML = rows
      .map((e) => {
        const qty = e.quantity != null ? `${Number(e.quantity).toLocaleString()} ${esc(e.unit || "")}`.trim() : "";
        const period = fmtPeriod(e.period_start, e.period_end);
        const meta = [fmtDate(e.expense_date), period ? `<span class="period-tag">Saklaw: ${period}</span>` : "", qty, e.paid_by ? `<b class="paid-by">Gumastos: ${esc(e.paid_by)}</b>` : "", e.notes ? esc(e.notes) : ""]
          .filter(Boolean)
          .join(" · ");
        return `<li data-cat="${esc(e.category)}">
          <div class="item"><span class="tag" data-cat="${esc(e.category)}">${esc(e.category)}</span>${esc(e.item)}</div>
          <div class="amount">${fmtPeso(e.amount)}</div>
          <div class="meta">${meta}</div>
          <div class="actions">
            <button data-edit="${esc(e.id)}">I-edit</button>
            <button data-del="${esc(e.id)}">Burahin</button>
          </div>
        </li>`;
      })
      .join("");
  }

  $("filter-category").addEventListener("change", renderExpenses);
  $("filter-person").addEventListener("change", renderExpenses);

  // Rent: kailangan ng start at end ng saklaw na binayaran
  function toggleRentFields() {
    const isRent = $("exp-category").value === "Rent";
    $("rent-period").hidden = !isRent;
    $("exp-period-start").required = isRent;
    $("exp-period-end").required = isRent;
  }

  $("exp-category").addEventListener("change", toggleRentFields);

  // Kapag pinili ang "mula" at wala pang "hanggang", lagyan ng 1 buwan
  $("exp-period-start").addEventListener("change", () => {
    const start = $("exp-period-start").value;
    if (!start || $("exp-period-end").value) return;
    const d = new Date(start + "T00:00:00");
    d.setMonth(d.getMonth() + 1);
    d.setDate(d.getDate() - 1);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    $("exp-period-end").value = d.toISOString().slice(0, 10);
  });

  const fmtPeriod = (a, b) => (a && b ? `${fmtDate(a)} – ${fmtDate(b)}` : a ? `mula ${fmtDate(a)}` : b ? `hanggang ${fmtDate(b)}` : "");

  function resetExpenseForm() {
    state.editingExpenseId = null;
    const keepDate = $("exp-date").value || today();
    const keepCat = $("exp-category").value;
    const keepWho = $("exp-paid-by").value;
    $("expense-form").reset();
    $("exp-date").value = keepDate;
    $("exp-category").value = keepCat;
    $("exp-paid-by").value = keepWho;
    toggleRentFields();
    $("expense-form-title").textContent = "Mag-input ng gastos";
    $("exp-submit").textContent = "I-save";
    $("exp-cancel").hidden = true;
  }

  $("exp-cancel").addEventListener("click", resetExpenseForm);

  $("expense-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.currentId) return toast("Pumili muna ng batch.", true);
    const isRent = $("exp-category").value === "Rent";
    const pStart = isRent ? $("exp-period-start").value || null : null;
    const pEnd = isRent ? $("exp-period-end").value || null : null;
    if (pStart && pEnd && pEnd < pStart) return toast("Dapat mas huli ang \"hanggang\" kaysa sa \"mula\" ng rent.", true);
    const row = {
      batch_id: state.currentId,
      expense_date: $("exp-date").value,
      category: $("exp-category").value,
      item: $("exp-item").value.trim(),
      quantity: numOrNull($("exp-qty").value),
      unit: textOrNull($("exp-unit").value),
      amount: Number($("exp-amount").value),
      notes: textOrNull($("exp-notes").value),
      paid_by: textOrNull($("exp-paid-by").value),
      period_start: pStart,
      period_end: pEnd,
    };
    await busy(e.submitter, async () => {
      const editing = state.editingExpenseId;
      const { error } = editing
        ? await db.from("expenses").update(row).eq("id", editing)
        : await db.from("expenses").insert(row);
      if (error) return fail(error);
      toast(editing ? "Na-update ang gastos." : "Na-save ang gastos.");
      if (row.paid_by && !state.people.includes(row.paid_by)) setPeople([...state.people, row.paid_by]);
      resetExpenseForm();
      await loadExpenses();
      renderOverview();
      $("exp-item").focus();
    });
  });

  $("expense-list").addEventListener("click", async (e) => {
    const editId = e.target.dataset.edit;
    const delId = e.target.dataset.del;

    if (editId) {
      const x = state.expenses.find((r) => r.id === editId);
      if (!x) return;
      state.editingExpenseId = x.id;
      $("exp-date").value = x.expense_date;
      $("exp-category").value = x.category;
      $("exp-item").value = x.item;
      $("exp-qty").value = x.quantity ?? "";
      $("exp-unit").value = x.unit || "";
      $("exp-amount").value = x.amount;
      $("exp-notes").value = x.notes || "";
      $("exp-paid-by").value = x.paid_by || "";
      $("exp-period-start").value = x.period_start || "";
      $("exp-period-end").value = x.period_end || "";
      toggleRentFields();
      $("expense-form-title").textContent = "I-edit ang gastos";
      $("exp-submit").textContent = "I-update";
      $("exp-cancel").hidden = false;
      $("expense-form").scrollIntoView({ behavior: "smooth", block: "start" });
      $("exp-item").focus();
    }

    if (delId) {
      const x = state.expenses.find((r) => r.id === delId);
      if (!x || !confirm(`Burahin ang "${x.item}" (${fmtPeso(x.amount)})?`)) return;
      const { error } = await db.from("expenses").delete().eq("id", delId);
      if (error) return fail(error);
      if (state.editingExpenseId === delId) resetExpenseForm();
      toast("Nabura.");
      await loadExpenses();
      renderOverview();
    }
  });

  // CSV export of current batch
  $("export-btn").addEventListener("click", () => {
    const b = currentBatch();
    if (!b || !state.expenses.length) return toast("Walang ma-export.", true);
    const header = ["Petsa", "Category", "Item", "Dami", "Unit", "Halaga", "Rent mula", "Rent hanggang", "Gumastos", "Notes", "Nag-input"];
    const lines = [header, ...state.expenses.map((e) => [
      e.expense_date, e.category, e.item, e.quantity ?? "", e.unit ?? "", Number(e.amount).toFixed(2), e.period_start ?? "", e.period_end ?? "", e.paid_by ?? "", e.notes ?? "", e.created_by ?? "",
    ])];
    downloadCsv(`${safeName(b.name)}-gastos.csv`, lines);
  });

  function safeName(name) {
    return String(name).replace(/[^\w\- ]+/g, "").trim() || "batch";
  }

  function downloadCsv(filename, rows) {
    const cell = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const text = rows.map((r) => r.map(cell).join(",")).join("\n");
    const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------
  function setTab(name) {
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
    $("overview-card").hidden = name !== "gastos";
    store.set(LAST_TAB_KEY, name);
  }

  document.querySelector(".tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (t) setTab(t.dataset.tab);
  });

  function setDatalist(id, values) {
    $(id).innerHTML = [...new Set(values.filter(Boolean))].sort(byNatural).map((v) => `<option value="${esc(v)}">`).join("");
  }

  function refreshMarkingSuggestions() {
    const all = [...state.culls.map((c) => c.markings), ...state.wingbands.map((w) => w.markings)];
    setDatalist("cull-markings-list", all);
    setDatalist("wb-markings-list", all);
  }

  // ---------------------------------------------------------------
  // Culled
  // ---------------------------------------------------------------
  async function loadCulls() {
    if (!state.currentId) { state.culls = []; return; }
    const { data, error } = await db
      .from("culls")
      .select("*")
      .eq("batch_id", state.currentId)
      .order("cull_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) return fail(error);
    state.culls = data;
    renderCulls();
  }

  function renderCulls() {
    const b = currentBatch();
    const total = state.culls.reduce((n, c) => n + Number(c.quantity), 0);
    $("cull-total").textContent = total.toLocaleString();
    $("tab-count-culled").textContent = total ? total.toLocaleString() : "";
    if (b?.chick_count) {
      $("cull-remaining").textContent = `${Math.max(b.chick_count - total, 0).toLocaleString()} / ${b.chick_count.toLocaleString()}`;
      $("cull-percent").textContent = ((total / b.chick_count) * 100).toFixed(1) + "%";
    } else {
      $("cull-remaining").textContent = "—";
      $("cull-percent").textContent = "—";
    }

    // bawat marking
    const per = {};
    for (const c of state.culls) per[c.markings] = (per[c.markings] || 0) + Number(c.quantity);
    const entries = Object.entries(per).sort((a, b) => b[1] - a[1] || byNatural(a[0], b[0]));
    $("cull-by-marking").hidden = entries.length === 0;
    $("cull-chips").innerHTML = entries
      .map(([m, q]) => `<div class="chip"><span class="who">${esc(m)}</span><span class="amt">${q.toLocaleString()}</span></div>`)
      .join("");

    $("cull-empty").hidden = state.culls.length > 0;
    $("cull-list").innerHTML = state.culls
      .map((c) => `<li class="rec-cull">
          <div class="item">${esc(c.markings)}</div>
          <div class="amount">${Number(c.quantity).toLocaleString()} <span class="unit">ulo</span></div>
          <div class="meta">${[fmtDate(c.cull_date), c.notes ? esc(c.notes) : ""].filter(Boolean).join(" · ")}</div>
          <div class="actions">
            <button data-edit="${esc(c.id)}">I-edit</button>
            <button data-del="${esc(c.id)}">Burahin</button>
          </div>
        </li>`)
      .join("");

    refreshMarkingSuggestions();
  }

  function resetCullForm() {
    state.editingCullId = null;
    const keepDate = $("cull-date").value || today();
    $("cull-form").reset();
    $("cull-date").value = keepDate;
    $("cull-form-title").textContent = "Mag-lista ng culled";
    $("cull-submit").textContent = "I-save";
    $("cull-cancel").hidden = true;
  }

  $("cull-cancel").addEventListener("click", resetCullForm);

  $("cull-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.currentId) return toast("Pumili muna ng batch.", true);
    const row = {
      batch_id: state.currentId,
      cull_date: $("cull-date").value,
      quantity: Number($("cull-qty").value),
      markings: $("cull-markings").value.trim(),
      notes: textOrNull($("cull-notes").value),
    };
    await busy(e.submitter, async () => {
      const editing = state.editingCullId;
      const { error } = editing
        ? await db.from("culls").update(row).eq("id", editing)
        : await db.from("culls").insert(row);
      if (error) return fail(error);
      toast(editing ? "Na-update ang culled." : "Na-save ang culled.");
      resetCullForm();
      await loadCulls();
      $("cull-qty").focus();
    });
  });

  $("cull-list").addEventListener("click", async (e) => {
    const editId = e.target.dataset.edit;
    const delId = e.target.dataset.del;
    if (editId) {
      const x = state.culls.find((r) => r.id === editId);
      if (!x) return;
      state.editingCullId = x.id;
      $("cull-date").value = x.cull_date;
      $("cull-qty").value = x.quantity;
      $("cull-markings").value = x.markings;
      $("cull-notes").value = x.notes || "";
      $("cull-form-title").textContent = "I-edit ang culled";
      $("cull-submit").textContent = "I-update";
      $("cull-cancel").hidden = false;
      $("cull-form").scrollIntoView({ behavior: "smooth", block: "start" });
      $("cull-qty").focus();
    }
    if (delId) {
      const x = state.culls.find((r) => r.id === delId);
      if (!x || !confirm(`Burahin ang culled na "${x.markings}" (${x.quantity})?`)) return;
      const { error } = await db.from("culls").delete().eq("id", delId);
      if (error) return fail(error);
      if (state.editingCullId === delId) resetCullForm();
      toast("Nabura.");
      await loadCulls();
    }
  });

  $("cull-export-btn").addEventListener("click", () => {
    const b = currentBatch();
    if (!b || !state.culls.length) return toast("Walang ma-export.", true);
    downloadCsv(`${safeName(b.name)}-culled.csv`, [
      ["Petsa", "Markings", "Quantity", "Notes", "Nag-input"],
      ...state.culls.map((c) => [c.cull_date, c.markings, c.quantity, c.notes ?? "", c.created_by ?? ""]),
    ]);
  });

  // ---------------------------------------------------------------
  // Wingband
  // ---------------------------------------------------------------
  async function loadWingbands() {
    if (!state.currentId) { state.wingbands = []; return; }
    const { data, error } = await db.from("wingbands").select("*").eq("batch_id", state.currentId);
    if (error) return fail(error);
    state.wingbands = data.sort((a, b) => byNatural(a.wingband_no, b.wingband_no));
    renderWingbands();
  }

  function renderWingbands() {
    const q = $("wb-search").value.trim().toLowerCase();
    const rows = state.wingbands.filter(
      (w) => !q || [w.wingband_no, w.markings, w.notes].some((v) => String(v ?? "").toLowerCase().includes(q))
    );
    const n = state.wingbands.length;
    $("tab-count-wingband").textContent = n ? n.toLocaleString() : "";
    $("wb-count").textContent = n ? `(${n.toLocaleString()})` : "";
    $("wb-empty").hidden = rows.length > 0;
    $("wb-empty").textContent = n ? "Walang tugma sa hinahanap." : "Wala pang wingband na naka-lista.";
    $("wb-list").innerHTML = rows
      .map((w) => `<li class="rec-wb">
          <div class="item"><span class="wb-no">#${esc(w.wingband_no)}</span>${w.markings ? esc(w.markings) : '<span class="muted">Walang markings</span>'}</div>
          <div class="amount"></div>
          <div class="meta">${w.notes ? esc(w.notes) : ""}</div>
          <div class="actions">
            <button data-edit="${esc(w.id)}">I-edit</button>
            <button data-del="${esc(w.id)}">Burahin</button>
          </div>
        </li>`)
      .join("");

    refreshMarkingSuggestions();
  }

  $("wb-search").addEventListener("input", renderWingbands);

  function resetWbForm() {
    state.editingWbId = null;
    $("wb-form").reset();
    $("wb-form-title").textContent = "Mag-lagay ng wingband";
    $("wb-submit").textContent = "I-save";
    $("wb-cancel").hidden = true;
  }

  $("wb-cancel").addEventListener("click", resetWbForm);

  $("wb-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.currentId) return toast("Pumili muna ng batch.", true);
    const row = {
      batch_id: state.currentId,
      wingband_no: $("wb-number").value.trim(),
      markings: textOrNull($("wb-markings").value),
      notes: textOrNull($("wb-notes").value),
    };
    await busy(e.submitter, async () => {
      const editing = state.editingWbId;
      const { error } = editing
        ? await db.from("wingbands").update(row).eq("id", editing)
        : await db.from("wingbands").insert(row);
      if (error?.code === "23505") return toast(`May wingband #${row.wingband_no} na sa batch na ito.`, true);
      if (error) return fail(error);
      toast(editing ? "Na-update ang wingband." : `Na-save ang wingband #${row.wingband_no}.`);
      resetWbForm();
      await loadWingbands();
      $("wb-number").focus();
    });
  });

  $("wb-list").addEventListener("click", async (e) => {
    const editId = e.target.dataset.edit;
    const delId = e.target.dataset.del;
    if (editId) {
      const x = state.wingbands.find((r) => r.id === editId);
      if (!x) return;
      state.editingWbId = x.id;
      $("wb-number").value = x.wingband_no;
      $("wb-markings").value = x.markings || "";
      $("wb-notes").value = x.notes || "";
      $("wb-form-title").textContent = `I-edit ang wingband #${x.wingband_no}`;
      $("wb-submit").textContent = "I-update";
      $("wb-cancel").hidden = false;
      $("wb-form").scrollIntoView({ behavior: "smooth", block: "start" });
      $("wb-number").focus();
    }
    if (delId) {
      const x = state.wingbands.find((r) => r.id === delId);
      if (!x || !confirm(`Burahin ang wingband #${x.wingband_no}?`)) return;
      const { error } = await db.from("wingbands").delete().eq("id", delId);
      if (error) return fail(error);
      if (state.editingWbId === delId) resetWbForm();
      toast("Nabura.");
      await loadWingbands();
    }
  });

  $("wb-export-btn").addEventListener("click", () => {
    const b = currentBatch();
    if (!b || !state.wingbands.length) return toast("Walang ma-export.", true);
    downloadCsv(`${safeName(b.name)}-wingband.csv`, [
      ["Wingband #", "Markings", "Notes", "Nag-input"],
      ...state.wingbands.map((w) => [w.wingband_no, w.markings ?? "", w.notes ?? "", w.created_by ?? ""]),
    ]);
  });

  // ---------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------
  db.auth.getSession().then(({ data }) => {
    if (data.session?.user) showApp(data.session.user);
    else showLogin();
  });

  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") showLogin();
  });
})();
