# Job App Autofill

A small Chrome extension that fills job application forms from a profile you
save once, instead of relying on each site's (often broken) resume-parsing
autofill.

## Install (unpacked, local)

1. Go to `chrome://extensions`
2. Turn on "Developer mode" (top right)
3. Click "Load unpacked" and select this folder:
   `autofill-extension`
4. Pin the extension so it's easy to reach

## Sharing with someone else

Zip up the `autofill-extension` folder (or grab `autofill-extension.zip` next
to it) and send it over. They unzip it and follow the **Install** steps
above - "Load unpacked" works the same on any Chrome profile/machine.

Each person's saved profile lives in their own browser's
`chrome.storage.local`, so sharing the folder does **not** share your
personal info - everyone fills out their own profile on the options page.

If you ever want a one-click install (no Developer mode, auto-updates), the
extension would need to be published to the Chrome Web Store, which requires
a one-time $5 developer registration and a review process. For sharing with
one person, the zip + "Load unpacked" route above is simpler and instant.

## Set up your profile (one time)

1. Click the extension icon -> "Edit my profile" (or right-click the icon ->
   Options)
2. A bunch of fields are pre-filled with what's already known (school, degree,
   current employer, address basics, work-auth defaults). Review everything,
   fill in the blanks (name, phone, address line 1, etc.), and click
   **Save profile**.
3. Everything is stored locally via `chrome.storage.local` - it never leaves
   your browser.

## Using it on an application

There are two modes, both from the extension popup:

- **Fill this page** - fills everything it can on the current page and stops.
  Filled fields briefly flash green. Good for a quick pass before you
  double-check and move on yourself.

- **Auto-fill & Continue** - fills the page, then clicks "Next" / "Continue" /
  "Save and Continue" and repeats automatically across a multi-step wizard
  (e.g. Workday's My Information -> My Experience -> Questionnaire flow). It
  **stops itself** in three cases:
  - It reaches a **Submit / Apply / Finish / Review** button - it never clicks
    these. A banner on the page tells you it's ready for your review.
  - The site flags a **required field as invalid** after clicking Next - it
    highlights the field in red and shows a panel telling you what needs an
    answer. Fill it in yourself, then click **Auto-fill & Continue** again to
    resume.
  - Clicking Next/Continue **silently does nothing** (no page change, no
    error the site normally flags) - it scans for fields with an error-ish
    CSS class or a reddish border and highlights/names whichever one it
    finds. If it can't find a culprit either, it stops and tells you to check
    the page manually - something is likely invalid in a way it can't detect.
  - It can't find a Next button, or hits a 25-step safety limit.

  A big red **STOP AUTOFILL** button stays pinned to the bottom-right of the
  page the whole time it's running - click it any time to cancel immediately.
  It does not auto-scroll the page; if it stops on an error, look for the
  red-outlined field (it stays highlighted) or read the panel text to see
  which field it means.

## How it learns

For every field, the content script (`content.js`) builds a "question text"
from the field's `<label>`, `aria-label`, `placeholder`, `name`, and (for
Workday) `data-automation-id` attributes, then:

1. Checks `FIELD_MAP` - the built-in patterns for common fields (name,
   address, education, work auth, EEO, etc.), filled from your profile.
2. If that doesn't match, checks the **learned answers** database - questions
   you've manually answered before, matched by wording (exact match, or
   "fuzzy" if most of the meaningful words overlap, e.g. "Desired Salary" vs
   "What is your desired salary expectation?").
3. If neither matches, the field is left blank. As soon as you type/select an
   answer yourself, it's saved to the learned-answers DB (visible and
   editable on the options page) for next time - this is how things like
   "Date of birth" or "When can you start?" get smarter over the first few
   applications.

Radio/checkbox groups are matched by their `<fieldset><legend>` or group
label, then the option whose own label text matches the target answer (e.g.
"Yes") gets checked.

### Avoiding collisions on generic "question" text

Some ATSes (Workday in particular) label every radio/checkbox group with a
generic description of the *answer type* - e.g. "Multiple Choice Response" -
on the `<legend>` or `aria-labelledby`, instead of the actual question
wording. If the extension trusted that text directly, "Do you require a
visa?", "Can you work in the US?", and "Have you been convicted of a felony?"
would all normalize to the same generic string and collide under one entry
in the learned-answers DB - whichever one was answered last would silently
overwrite the others.

`getGroupQuestionText` in `content.js` recognizes and ignores these generic
labels (`GENERIC_GROUP_LABEL_RE`) and instead looks at nearby preceding
elements (walking up a few levels of parent containers) for text that isn't
one of the option labels and isn't itself generic - this is normally the
actual question text rendered just above the radio group. If you notice a
learned answer with a vague label like "multiple choice response" in the
options table, delete it and re-teach the field (ideally via Learn mode,
where you can edit the detected question text before saving) so it gets a
proper, distinguishing label.

### Dropdown vs. text-with-dropdown ("combobox") fields

Fields like State, Country, or Degree sometimes render as a real
`<select>`, and sometimes as a text `<input>` with its own popup list (a
"combobox" - common in Workday). Typing a value into a combobox isn't enough;
the site only registers a selection once you click an option in its popup.

The content script detects this (`role="combobox"`, `aria-autocomplete`, or
`aria-haspopup="listbox"` on the input) and, after typing the value, looks for
the popup's matching option and clicks it. If no match is found in the popup
within ~1.5s, the field is left as typed and will likely surface as a
validation/silent error for you to fix manually.

### Manually teaching it an answer

On the options page, under "Learned answers", you can add an entry directly -
type the field's label/question text and the answer you want, and it's stored
the same as if you'd typed that answer on a real page. Useful for fields whose
value doesn't get auto-learned (e.g. a combobox where the popup-option match
fails) or to pre-seed common answers before you've seen the question yet.

### Learn mode (teach answers directly on the page)

Click **Learn mode: off** in the popup to turn it on (it becomes **Learn
mode: on**). A panel appears in the bottom-left corner, and a small yellow
**🎓 Learn** button is inserted directly into the page right after every
field the extension couldn't fill - i.e. it has no `FIELD_MAP`,
learned-answer, or regex-rule match (and isn't blocked by the per-application
guardrail). Because the button is part of the page itself (not an overlay),
it scrolls naturally with its field.

Click a **🎓 Learn** button to open a small popover:

- The detected question text is shown in an editable box - fix it if the
  auto-detected wording looks wrong before saving.
- **Radio/checkbox groups** show one button per option - click the one that's
  the correct answer.
- **`<select>` dropdowns** show a dropdown of the field's own options - pick
  one and click "Use this answer".
- **Text fields** show an input pre-filled with whatever's currently in the
  field - edit it and click "Save".

Saving immediately fills the field on the page (briefly flashing green) and
stores the answer in the learned-answers DB, exactly like manually typing it
would.

If the answer you just gave matches an answer you've already given to a
similarly-worded question (same answer, and the question wording shares
enough significant words), a follow-up popover suggests generalizing both
into a single **regex learned-answer rule** - e.g. after teaching both "Are
you authorized to work in the US without sponsorship?" and "Will you now or
in the future require sponsorship to work in the US?" with the same answer,
it'll offer to turn them into one rule covering both (and similar future
wordings). Review/edit the suggested patterns and click "Add rule", or
"Skip" to just keep the individual learned answer.

The page is rescanned automatically (after each save, and whenever the page
changes, e.g. moving to the next step of a multi-step application) so the
Learn buttons stay in sync with what's actually still unanswered. Turn it
off via the popup button or the "Turn off Learn mode" button in the panel.

### Regex learned answers (advanced)

For radio/checkbox or `<select>` questions whose wording varies between sites
but where you always want the same kind of answer - e.g. "Were you referred by
a current employee?" / "Do you know anyone who works here?" -> always "No" -
you can add a rule under "Regex learned answers":

- **Question pattern**: a regex tested (unanchored, case-insensitive by
  default) against the field's full label/question text. E.g.
  `referred|current` matches "Were you referred by a current employee?".
- **Answer pattern**: a regex tested against each option's own visible text;
  the first option that matches gets selected. E.g. `\bno\b` matches an
  option labeled "No".
- **Flags**: JS regex flags, default `i`. Note this is JS regex syntax, not
  PCRE - inline modifiers like `(?i)` aren't supported, use the Flags field
  instead.

These rules are checked after `FIELD_MAP` and the normal learned-answers
match, and only for radio/checkbox groups and `<select>` dropdowns (a regex
doesn't give a single literal value to type into a text field). The
per-application guardrail still applies - a rule won't fire on a question like
"Have you applied to this company before?".

### Guardrail: per-application questions are never learned

Questions whose correct answer depends on *this specific company/application* -
e.g. "Have you applied to **this company** before?", "Do you have relatives
working **here**?", "How did you hear about **this position**?", "Have you
signed a non-compete?" - are deliberately excluded from both auto-fill and
learning (see `PER_APPLICATION_RE` in `content.js`). They're always left
blank, which (in Auto-fill & Continue mode) causes the site's own validation
to flag them and pause for your input - so you answer them fresh, correctly,
every time, and a wrong answer never gets silently reused on another company's
application.

## Known limitations

- **Repeating sections** (multiple jobs/schools via "Add Another
  Experience/Education") - only the single most-recent entry from your
  profile is available, so it'll only fill the first instance it finds. Extra
  rows still need manual entry.
- **Cover letters / "why do you want to work here"** - intentionally left
  blank. Too personal to template, and these are exactly the kind of
  per-application question covered by the guardrail above.
- **File uploads** (resume/cover letter PDFs) - not handled; browsers don't
  allow extensions to programmatically attach files for security reasons.
- **Custom/JS-heavy widgets** (date pickers rendered as buttons, custom
  dropdown components instead of `<select>`) - may not be detected. The
  matcher only looks at real `<input>`, `<select>`, and `<textarea>`
  elements.
- Already-filled text/select fields are left alone (won't overwrite values),
  but radio/checkbox groups can still get changed if they match - review
  before submitting.
- Error detection is heuristic (`aria-invalid="true"`, `role="alert"`, "this
  field is required"-style text). Sites that show errors differently might not
  get caught, so always glance at the page when auto-fill stops.

## Tuning

- Add/adjust matching patterns in `FIELD_MAP` (and the `PER_APPLICATION_RE`
  guardrail list) in `content.js`.
- Add/adjust your saved profile and learned answers via the options page (or
  directly in `chrome://extensions` -> Inspect views -> Application -> Local
  Storage if you want to bulk-edit the JSON).
