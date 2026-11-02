# Setting up Clarion

About 45 minutes, in six parts. Each part ends with something you can check. Nothing here needs a command line.

Keep a private note open as you go (in your password manager, ideally). **Never put the values in a document, email or chat.**

> **Don't press "Regenerate tokens" in Bunny Database.** It cancels the tokens of every database in the account, which would stop the website and the knowledgebase signing anyone in.

---

## Part 1. Merge the pull request

1. In GitHub, open **sdawilson/fhrg-clarion → Pull requests**, open the pull request, and click **Merge**.
2. Open the **Actions** tab. A run called **Build and deploy** starts by itself. Wait for the green tick (about 3 minutes).
3. On the repository's main page, under **Packages** on the right, open `fhrg-clarion`. Choose **Package settings → Change visibility → Public**. The image holds no keys or passwords, so it's safe to make public, and bunny.net can then fetch it without a GitHub password.

✔ **Check:** the `fhrg-clarion` package page shows a tag called `latest`.

---

## Part 2. Storage

1. In bunny.net, open **Storage → Add Storage Zone**. Name it `fhrg-clarion`, with **London** as its main region.
2. Open its **FTP & API Access** page. Note the **Password** (not the read-only one) as `STORAGE_ACCESS_KEY`, and the **Hostname** as `STORAGE_HOST`.

✔ **Check:** the zone appears in your list of storage zones.

---

## Part 3. Keys

You need four values:

- **ANTHROPIC_API_KEY:** make a new key in the Anthropic Console called "FHRG Clarion". While you're there, make sure web search and web fetch are on under the organisation's **Capabilities**.
- **FHRG_REF_KEY:** the App Builder's **Admin → Reference data → Keys for outside services**. Make a new key called "Clarion".
- **WEBSITE_DATABASE_URL** and **WEBSITE_DATABASE_AUTH_TOKEN:** the same read-only values the knowledgebase uses. If you don't have the token, **stop and ask Claude** rather than generating one (see the warning at the top).
- **SESSION_SECRET:** in your password manager, generate a random password, **64 characters, letters and numbers only**.

---

## Part 4. The container

1. In bunny.net, go to **Magic Containers → + Add App**.
2. **Image:** `ghcr.io/sdawilson/fhrg-clarion`, tag `latest`.
3. **Endpoints:** add one, **+ CDN**: name `clarion`, container port **8080**.
4. **Persistent volumes:** none.
5. **Environment variables:** choose **Raw editor** and paste these lines, with your values after each `=`:

```
STORAGE_ZONE=fhrg-clarion
STORAGE_HOST=
STORAGE_ACCESS_KEY=
WEBSITE_DATABASE_URL=
WEBSITE_DATABASE_AUTH_TOKEN=
SESSION_SECRET=
ANTHROPIC_API_KEY=
FHRG_REF_KEY=
SITE_ADMINS=s.wilson@provingservices.co.uk
MONTHLY_CAP_USD=40
```

6. **App name:** `fhrg-clarion`. **Region:** London (or the nearest UK region offered).
7. Click **Deploy**.
8. After it starts, open **Regions and Scaling** and set it to **exactly one instance** (minimum 1, maximum 1).

✔ **Check:** open the endpoint's address (bunny.net shows it) and add `/health`. It should say `{"ok":true}`. In **Logs**, Clarion says `all required settings are present`.

If the log says **required settings missing**, bunny.net may have dropped that setting because of an invisible character copied into its *name*. Delete the row, add it again with **+ Add New Variable**, **typing the name by hand**, and click **Update Container**.

---

## Part 5. Automatic updates

From now on, every change Claude makes reaches the container by itself.

1. In Magic Containers, open the app. Note its **App ID** and the container's name.
2. In GitHub, open **sdawilson/fhrg-clarion → Settings → Secrets and variables → Actions**:
   - under **Variables**, add `APP_ID` (the App ID) and `CONTAINER_NAME` (the container's name)
   - under **Secrets**, add `BUNNYNET_API_KEY` (your bunny.net account API key: the same one the knowledgebase uses)

✔ **Check:** in the **Actions** tab, open **Build and deploy → Run workflow**. It ends with a green tick, including the step **Update the app on Magic Containers**.

---

## Part 6. The address, and a first try

1. Open the container endpoint's pull zone **→ Hostnames**, and add `clarion.fhrg.co.uk`.
2. Where fhrg.co.uk's DNS is managed, add a `clarion` **CNAME** record pointing to the pull zone's `b-cdn.net` address (bunny.net shows the exact value).
3. Back in the pull zone, turn on **Force SSL** and click to issue the free certificate.

✔ **Check:**
- https://clarion.fhrg.co.uk/health says `{"ok":true}`.
- Sign in at https://clarion.fhrg.co.uk with your FHRG email and password. You should see the three pilot authorities.
- Open West Sussex. The evidence appears, and "What's missing" lists only real gaps. If a source says it couldn't be read, tell Claude which.
- Click **Write the first reading**, and wait a minute or two.
- Open **Impact notes**, choose an announcement, and click **Write the impact note**.

---

## From now on

- **Updates:** Claude makes each change on GitHub as a pull request. You read the summary and click **Merge**; it's live about five minutes later.
- **Keep it to exactly one instance** (Regions and Scaling: minimum 1, maximum 1).
- **Type setting names by hand** when you add one, then click **Update Container**.
- **Spending:** site administrators see the month's Claude spend at the bottom of the side rail. Clarion stops starting new work at `MONTHLY_CAP_USD`. Each authority can also start up to `DAILY_JOBS_MAX` readings and notes a day (20 unless you set it); site administrators aren't limited.
- **Signing in from the website:** members open Clarion from `https://fhrg.co.uk/clarion` and arrive signed in, using `CLARION_SSO_SECRET` on the website and `SSO_SECRET` here.
- **Street surveys:** Clarion's Census figures come from the data library's `census_age_sex_la` table. Each authority can ask Claude for help with surveys up to 100 times a day, and a scan counts as one. Scans aren't kept. What Claude read from a scan goes when it's saved, or within about a week if nobody saves it.

## If something isn't right

| What you see | What to do |
|---|---|
| The page says "Clarion is not set up yet. Missing settings: …" | Add the named settings (type the names by hand) and click **Update Container** |
| "The data library refused Clarion's key" | Check `FHRG_REF_KEY` against the App Builder's list of keys |
| "Web search or fetch isn't available" | Turn them on in the Anthropic Console, under the organisation's **Capabilities** |
| A source says "couldn't be read just now" | Try again later. If it stays that way, tell Claude which source |
| "Clarion has reached this month's spending limit" | Raise `MONTHLY_CAP_USD`, or wait for the new month |
| "has reached today's limit" | Try again tomorrow, or raise `DAILY_JOBS_MAX` |
| A survey says "Census figures couldn't be read" | Check the data library has been reloaded, and that `FHRG_REF_KEY` works. Results still appear, unweighted |
| A tablet says forms are still on it | The survey is closed. Open it again on the **Collect** tab, then press **Try again** on the tablet |
| "Something went wrong" | Open the app's **Logs** in Magic Containers; the last lines say why |
| `/health` doesn't answer | Open the app's **Logs** in Magic Containers; the last lines say why it stopped |
| The **Build and deploy** run fails | Open it in the **Actions** tab; the failing step is marked. Tell Claude what it says |
