# JER Gamefarm: Expense Monitoring

Simpleng website para i-record ang mga gastos sa pag-aalaga ng manok, **per batch** (hal. Early Bird, National).
Feeds, bakuna, gamot, vitamins at iba pa. Puwedeng gamitin nang sabay ng dalawa o higit pang tao, sa cellphone o laptop.

**Features**
- Gumawa ng batch: pangalan, uri (Early Bird / National), petsa ng simula, bilang ng sisiw
- Mag-input, mag-edit at mag-delete ng gastos: petsa, category, item, dami, unit, halaga, notes
- Summary per batch: kabuuang gastos, breakdown per category, gastos **bawat sisiw**
- Overview ng lahat ng batch
- I-download ang gastos ng batch bilang CSV (bubukas sa Excel o Google Sheets)
- May login. Ang mga email na nakalista sa database lang ang may access.

**Paano gumagana**
- **GitHub Pages** ang nagho-host ng website (libre)
- **Supabase** ang database at login (libre)

---

## Setup (isang beses lang, mga 15 minuto)

### Step 1: Gumawa ng Supabase project

1. Pumunta sa <https://supabase.com> at mag-sign up (puwede gamit ang GitHub account mo).
2. I-click ang **New project**.
   - Name: `ex-monitoring`
   - Database password: gumawa ng malakas na password at **itago ito**
   - Region: **Southeast Asia (Singapore)**
3. Hintaying matapos (mga 1–2 minuto).

### Step 2: Gawin ang database tables

1. Sa Supabase, pumunta sa **SQL Editor**, tapos **New query**.
2. Buksan ang file na [`supabase/schema.sql`](supabase/schema.sql) at kopyahin ang buong laman.
3. **Bago i-Run**, hanapin sa pinakababa ang part na ito at palitan ng tunay na email ninyong dalawa:
   ```sql
   insert into public.allowed_emails (email) values
     ('ikaw@example.com'),
     ('partner@example.com')
   ```
4. I-paste sa SQL Editor at i-click ang **Run**. Dapat lumabas ang *"Success. No rows returned"*.

### Step 3: Gumawa ng login ninyong dalawa

1. Pumunta sa **Authentication > Users > Add user > Create new user**.
2. Ilagay ang email at password mo. **I-check ang "Auto Confirm User"**, tapos i-click ang Create.
3. Ulitin para sa partner mo (parehong email na inilagay sa Step 2).

### Step 4: Patayin ang public sign-up (para sa security)

1. Pumunta sa **Authentication > Sign In / Providers** (o **Providers > Email** sa ibang version).
2. I-**off** ang **"Allow new users to sign up"**, tapos Save.

> Kahit may makapag-sign up, hindi pa rin nila makikita ang data. Ang mga email lang na nasa `allowed_emails` ang may access.
> Pero mas mabuting naka-off pa rin ito.

### Step 5: Ilagay ang Supabase keys sa `config.js`

1. Sa Supabase, pumunta sa **Project Settings > API** (o **Data API / API Keys**).
2. Kopyahin ang:
   - **Project URL**, hal. `https://abcdefgh.supabase.co`
   - **anon public** key (mahabang text na nagsisimula sa `eyJ...`, o `sb_publishable_...` sa bagong version)
3. Buksan ang [`ex-monitoring/config.js`](ex-monitoring/config.js) at palitan:
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: "https://abcdefgh.supabase.co",
     SUPABASE_ANON_KEY: "eyJ...",
   };
   ```

> ✅ **Okay lang na makita ng publiko ang anon key.** Ginawa ito para ilagay sa website.
> ❌ **Huwag ilalagay dito ang `service_role` / secret key.** Iyon ang delikado.

### Step 6: I-push sa GitHub

Sa Terminal, sa loob ng folder na ito:

```bash
git add .
git commit -m "Initial version ng ex-monitoring"
git push
```

### Step 7: I-on ang GitHub Pages

1. Pumunta sa <https://github.com/jaysonsa/jer-gamefarm>, tapos **Settings > Pages**.
2. Sa **Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: **main**, folder **/ (root)**, tapos **Save**
3. Maghintay ng 1–2 minuto. Lalabas ang link:
   **<https://jaysonsa.github.io/jer-gamefarm/ex-monitoring/>**

Ibigay ang link sa partner mo, tapos mag-login siya gamit ang email at password na ginawa sa Step 3.

> 💡 Sa cellphone, buksan ang link, tapos **Add to Home Screen** para parang app na.

---

## Pagsubok sa sariling computer (optional)

```bash
cd ~/Personal/ex-monitoring
python3 -m http.server 8080
```
Tapos buksan ang <http://localhost:8080/ex-monitoring/>.

---

## Mga madalas na tanong

**Paano magdagdag ng bagong user?**
1. Sa Supabase SQL Editor, i-run ang:
   `insert into public.allowed_emails (email) values ('bagong@email.com');`
2. Gawin ang login niya sa **Authentication > Users > Add user** (Auto Confirm).

**Paano magtanggal ng access?**
I-delete ang user sa **Authentication > Users**, tapos i-run ang:
`delete from public.allowed_emails where email = 'email@nila.com';`

**Nakalimutan ang password?**
Sa **Authentication > Users**, i-click ang user, tapos **Send password recovery** o i-delete at gawin ulit.

**Lumalabas ang "Walang permiso"?**
Hindi nakalista ang email sa `allowed_emails`, o iba ang spelling. Tingnan sa **Table Editor > allowed_emails**.

**Nawawala ba ang data kapag hindi nagamit?**
Sa libreng Supabase plan, naka-*pause* ang project kapag walang gumamit nang 7 araw. Hindi nawawala ang data. Pumunta lang sa Supabase dashboard at i-click ang **Restore project**.
Para sa backup, gamitin ang **CSV** button paminsan-minsan, o **Table Editor > Export to CSV**.

---

## Mga file

| File | Para saan |
|---|---|
| `index.html` | Nagdadala sa `ex-monitoring/` |
| `ex-monitoring/index.html` | Ang itsura ng website |
| `ex-monitoring/style.css` | Kulay at layout |
| `ex-monitoring/app.js` | Lahat ng logic (login, batch, gastos, summary) |
| `ex-monitoring/config.js` | Supabase URL at anon key |
| `supabase/schema.sql` | Database tables at security rules |
