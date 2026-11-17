import type { PermissionKey } from "@/lib/permissions/catalog";

/**
 * In-app user guide. Plain data so it renders on the server, can be searched in the browser and
 * stays in sync with the code it describes (update it with any change to a screen it names).
 * Text supports **bold** only. Hotel sections carry the permissions that make them relevant: a
 * section is shown to a staff member holding ANY of them (no list = everyone).
 */
export type GuideBlock =
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "tip"; text: string }
  | { kind: "warn"; text: string }
  | { kind: "links"; items: { href: string; label: string }[] }
  | { kind: "media"; items: GuideMedia[] };

/** A screenshot or screen recording from public/guide (demo hotel, QR codes masked). */
export interface GuideMedia {
  type: "image" | "video";
  src: string;
  caption: string;
  /** Phone-sized capture: shown narrow, in a phone frame. */
  phone?: boolean;
}

export interface GuideSection {
  id: string;
  group: string;
  title: string;
  icon: string;
  summary: string;
  permissions?: PermissionKey[];
  blocks: GuideBlock[];
}

export interface Guide {
  key: "platform" | "hotel";
  title: string;
  intro: string;
  /** The order to do things in, shown as a strip of numbered cards at the top. */
  journey: { title: string; text: string; section: string }[];
  sections: GuideSection[];
}

// ---------------------------------------------------------------------------------------------
// Hotel guide (owners, managers and staff)
// ---------------------------------------------------------------------------------------------

const HOTEL_SECTIONS: GuideSection[] = [
  {
    id: "getting-started",
    group: "Start here",
    title: "How the system works",
    icon: "rocket",
    summary: "Guests scan a QR code in their room, ask for things, and your team handles them from one Requests list.",
    blocks: [
      {
        kind: "p",
        text: "Every room has its own QR code. A guest scans it with the phone camera (no app, no login), sees your hotel page and sends requests such as water, towels, food or a repair. The request reaches the right department straight away, and the guest watches its progress live.",
      },
      {
        kind: "table",
        head: ["Who", "Where they work", "What they do"],
        rows: [
          ["Owner / manager", "Dashboard, Properties, Staff, Billing", "Set up the hotel, rooms, QR codes, services, design and staff"],
          ["Receptionist", "Front desk, Reservations, Requests", "Bookings, check-in/out, guest bills, reception requests"],
          ["Housekeeping", "Housekeeping, Requests", "Clean rooms after checkout, towel and cleaning requests"],
          ["Room service", "Requests", "Food and drink orders"],
          ["Maintenance / Security", "Requests", "Repairs, problems and safety requests"],
          ["Guest", "Room QR page", "Hotel info, Wi-Fi, requests, orders"],
        ],
      },
      {
        kind: "tip",
        text: "You only see the menus and guide sections your role needs. If something is missing, ask your hotel owner to check your role on the Staff page.",
      },
    ],
  },
  {
    id: "setup-checklist",
    group: "Start here",
    title: "First-time setup checklist",
    icon: "list-checks",
    summary: "The order to set up a new hotel, about 30 minutes in total.",
    permissions: ["property.manage", "room.manage", "tenant.manage"],
    blocks: [
      {
        kind: "steps",
        items: [
          "**Add your property**: Properties → Add property (name, address, timezone, currency).",
          "**Create floors and room types**: open the property → Floors tab, then Room types tab.",
          "**Add rooms**: Rooms tab → Add room, or the bulk form for a whole floor (for example 101 to 120).",
          "**Check departments and services**: Departments and Services tabs. Defaults are created for you.",
          "**Fill in guest information**: Guest portal tab (Wi-Fi, reception phone, check-in/out times, welcome message).",
          "**Design the guest page**: Design & photos tab (template, colours, logo, cover and gallery photos).",
          "**Create and print QR codes**: QR codes tab → create missing codes → Print.",
          "**Invite your team**: Staff → Invite a staff member, then send each person their link.",
          "**Test it**: scan one QR code with your phone and send a request. It should appear under Requests.",
        ],
      },
      { kind: "links", items: [{ href: "/properties", label: "Open Properties" }, { href: "/staff", label: "Open Staff" }] },
    ],
  },
  {
    id: "property-setup",
    group: "Set up your hotel",
    title: "Properties, floors, room types and rooms",
    icon: "building",
    summary: "Build the room structure: rooms need a floor and a room type first.",
    permissions: ["property.manage", "room.manage"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Go to **Properties** and click **Add property**. Each property has its own timezone, currency and rooms. A hotel group can add several.",
          "Open the property. In the **Floors** tab add each floor (Ground, 1st, 2nd…).",
          "In the **Room types** tab add each type with its capacity (Standard, Deluxe, Suite…).",
          "In the **Rooms** tab click **Add room**: room number, floor and room type. Use the bulk form on the same page to add a whole range at once.",
          "Open the **Departments** tab to check which teams receive requests (Reception, Housekeeping, Room service, Maintenance, Security).",
          "Use the **Settings** tab to change the property's name, address, timezone and currency later.",
        ],
      },
      { kind: "tip", text: "A new room starts clean and Ready, so you can check a guest into it straight away." },
      {
        kind: "p",
        text: "To take a room out of use (renovation, broken AC), open the room and set its status to **Out of order**, **Maintenance** or **Inactive**. It can't be checked into until you set it back to **Active**.",
      },
      { kind: "links", items: [{ href: "/properties", label: "Open Properties" }, { href: "/rooms", label: "Open Rooms" }] },
    ],
  },
  {
    id: "qr-codes",
    group: "Set up your hotel",
    title: "Room QR codes",
    icon: "qr",
    summary: "Create, print and look after the QR sticker in every room.",
    permissions: ["qr.view", "qr.manage"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open the property → **QR codes** tab.",
          "Click the button to create codes for every room that doesn't have one yet.",
          "Click **Print** for a printable sheet with the room number under each code. Print on sticker paper or cards.",
          "Place each code in its own room (bedside table, desk or back of the door).",
          "Scan one with your phone to check it opens the right room.",
        ],
      },
      {
        kind: "table",
        head: ["Action (room page → QR card)", "When", "What happens"],
        rows: [
          ["Download", "One sticker is damaged", "Same code, nothing changes"],
          ["Replace", "The code was photographed or misused", "The old sticker stops working at once; print the new one"],
          ["Deactivate", "Room under renovation", "Guests scanning it see an \"unavailable\" page"],
          ["Reactivate printed code", "Room back in use", "The same sticker works again"],
        ],
      },
      { kind: "warn", text: "Each code belongs to one room. Never stick a code in a different room: requests would go to the wrong room number." },
    ],
  },
  {
    id: "services",
    group: "Set up your hotel",
    title: "Services and menus",
    icon: "bell",
    summary: "Choose what guests can ask for, who receives it and how fast it must be answered.",
    permissions: ["service.manage"],
    blocks: [
      {
        kind: "p",
        text: "Default services are created for you: Drinking water, Housekeeping, Reception assistance, Report a problem and Something else, plus In-room dining and Laundry menus when your plan includes ordering. Edit them in the property's **Services** tab.",
      },
      {
        kind: "table",
        head: ["Setting", "What it does"],
        rows: [
          ["Name, description, icon", "What the guest sees on the tile"],
          ["Department", "Which team receives the request"],
          ["Type", "Simple request, menu (items with prices) or booking"],
          ["Choices / max quantity", "Options the guest picks from, e.g. \"Still / Sparkling\", up to N"],
          ["Guest note", "None, optional or required"],
          ["Priority", "Low, normal, high or urgent"],
          ["Available from / to", "Hours the service can be requested (e.g. 07:00 to 23:00)"],
          ["Target minutes", "How quickly it should be accepted"],
          ["Escalate", "Flag it in red to managers if not accepted in time"],
          ["Allow room charge", "Guests can charge menu orders to their room bill"],
          ["Message to guest", "Shown after sending, e.g. \"Water arrives in 10 minutes\""],
          ["Enabled / order", "Hide a service, or change its position"],
        ],
      },
      { kind: "p", text: "For a menu service click **Menu** to add sections and items with prices." },
    ],
  },
  {
    id: "guest-page",
    group: "Set up your hotel",
    title: "Guest page: information, design and photos",
    icon: "palette",
    summary: "What guests read after scanning, and how it looks.",
    permissions: ["property.manage"],
    blocks: [
      {
        kind: "p",
        text: "**Guest portal tab**: turn the guest page on/off, show the room number, welcome message, Wi-Fi name and password, Wi-Fi note, reception phone, contact email and check-in/check-out times.",
      },
      {
        kind: "steps",
        items: [
          "Open the property → **Design & photos** tab.",
          "**Choose a template**: Classic (coloured header), Photo (big pictures), Elegant (luxury, serif) or Minimal (compact).",
          "**Pick colours**: click a ready-made palette, or choose your own main colour and page background. Text colour adjusts itself so it stays readable.",
          "**Font and gallery**: Modern or Classic font; show or hide the photo gallery.",
          "Check the phone-sized **Live preview** on the right, then click **Save design**.",
          "**Photos**: upload a logo, a cover photo, up to 20 gallery photos (add captions, reorder with the arrows) and an optional photo for each service.",
        ],
      },
      { kind: "tip", text: "Photos straight from a phone are fine: they are resized automatically before upload. JPG, PNG and WebP are accepted." },
    ],
  },
  {
    id: "staff",
    group: "Set up your hotel",
    title: "Staff and roles",
    icon: "users",
    summary: "Give every team member their own login with only the access they need.",
    permissions: ["staff.view", "staff.manage"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open **Staff** and fill in **Invite a staff member**: name, email, role and property.",
          "Copy the invitation link and send it to the person (WhatsApp or email).",
          "They open the link, choose a password and sign in.",
        ],
      },
      {
        kind: "table",
        head: ["Role", "Can do"],
        rows: [
          ["Hotel Owner", "Everything, including billing and hotel settings"],
          ["Hotel Manager", "Property operations, staff oversight, reports and escalations"],
          ["Receptionist", "Rooms, check-in/out, reservations, bills, reception requests"],
          ["Housekeeping", "Housekeeping board and cleaning requests"],
          ["Room Service", "Food and drink requests"],
          ["Maintenance", "Repairs and problem reports"],
          ["Security", "Security and emergency requests"],
        ],
      },
      {
        kind: "list",
        items: [
          "Open a person to change their role or **Deactivate** them when they leave (they are signed out at once). **Reactivate** undoes it.",
          "Unused invitations can be revoked from the Staff page.",
          "**Staff → Roles** shows exactly what each role may do.",
          "A hotel always keeps at least one active Hotel Owner.",
        ],
      },
    ],
  },
  {
    id: "reservations",
    group: "Daily work",
    title: "Reservations",
    icon: "calendar",
    summary: "Take bookings by room type; the system prevents overbooking.",
    permissions: ["reservation.view", "reservation.manage"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open **Reservations** → **New booking**: guest name, room type, arrival, departure, guests, optional contact, where it was booked and an external reference.",
          "The **Availability calendar** shows how many rooms of each type are free per night.",
          "The room is chosen at check-in, unless you assign one in advance.",
          "On arrival day the booking appears under **Arrivals** on the Front desk.",
        ],
      },
      {
        kind: "table",
        head: ["Status", "When"],
        rows: [
          ["Confirmed", "Booking created"],
          ["Checked in", "Guest checked in"],
          ["Completed", "Guest checked out"],
          ["Cancelled", "Staff cancelled it (reason required)"],
          ["No-show", "Automatically overnight if not checked in by the end of arrival day, or marked by staff"],
        ],
      },
    ],
  },
  {
    id: "front-desk",
    group: "Daily work",
    title: "Check-in and check-out",
    icon: "key",
    summary: "Front desk: arrivals, walk-ins, in-house guests and departures.",
    permissions: ["stay.view", "stay.check_in", "stay.check_out"],
    blocks: [
      {
        kind: "steps",
        items: [
          "**Booked guest**: Front desk → Arrivals → **Check in**, then pick a Ready room.",
          "**Walk-in guest**: fill in **Walk-in check-in**: room, guest name, optional phone/email, guests, checkout date and time, staff-only notes.",
          "The guest now appears under **In-house guests**, and their room shows **Occupied**.",
          "**Check-out**: click **Check out** on the guest's row and confirm. If the bill isn't settled, settle it first or tick the option to leave it open.",
          "After check-out the room becomes **Needs cleaning** and a cleaning task appears on the Housekeeping board automatically.",
        ],
      },
      { kind: "tip", text: "Only Ready rooms can be chosen: in service, empty, cleaned and (if required) inspected. A room missing from the list is not ready yet." },
      { kind: "links", items: [{ href: "/front-desk", label: "Open Front desk" }] },
    ],
  },
  {
    id: "bills",
    group: "Daily work",
    title: "Guest bills and orders",
    icon: "receipt",
    summary: "Room charges from food and laundry orders, extra charges and payments.",
    permissions: ["folio.view", "folio.manage"],
    blocks: [
      {
        kind: "list",
        items: [
          "When a checked-in guest orders from a menu and chooses **charge to room**, the order is added to their bill automatically.",
          "Open the bill from the Front desk (in-house guest row). It shows **Charges**, **Payments** and **Balance due**.",
          "Use **Add charge** for extras (minibar, late checkout) and **Record payment** for cash, card or UPI received.",
          "Orders marked **pay on delivery** are collected by the delivering staff and are not added to the bill.",
        ],
      },
    ],
  },
  {
    id: "requests",
    group: "Daily work",
    title: "Handling guest requests",
    icon: "inbox",
    summary: "Accept, start and complete requests; the guest sees every step.",
    permissions: ["request.view"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open **Requests** (top of the menu). The badge shows how many requests are new; a red badge means some are **Escalated** (not accepted in time).",
          "Open a request to see the room, service, choices, quantity, guest note and order lines.",
          "Click **Accept** so the guest knows the team has it.",
          "Click **Start** when someone is on the way, then **Complete** when it's done.",
          "Managers can **Assign** a request to a specific staff member.",
          "**Cancel** or **Reopen** need a reason. Add a message for the guest if helpful.",
        ],
      },
      {
        kind: "table",
        head: ["Staff sees", "Guest sees"],
        rows: [
          ["New", "Request sent"],
          ["Accepted", "Hotel team notified"],
          ["In progress", "Being handled"],
          ["Completed", "Completed"],
          ["Cancelled", "Cancelled – please contact reception"],
          ["Reopened", "Being reviewed"],
        ],
      },
      {
        kind: "tip",
        text: "Turn on phone notifications in **My profile** to get an alert for every new request you can see, or only those assigned to you. After a request is completed the guest can rate it; the stars and comment appear on the request page under **Guest rating**.",
      },
      { kind: "links", items: [{ href: "/inbox", label: "Open Requests" }, { href: "/profile", label: "Notification settings" }] },
    ],
  },
  {
    id: "housekeeping",
    group: "Daily work",
    title: "Housekeeping",
    icon: "sparkles",
    summary: "Clean rooms after checkout and get them Ready again.",
    permissions: ["housekeeping.view", "housekeeping.manage"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open **Housekeeping**. Rooms waiting for work are under **To do**.",
          "Click **Start cleaning** when you begin, then **Done** when finished.",
          "If inspection is required, a supervisor checks the room and clicks **Pass**. The room becomes **Ready**. A failed inspection sends it back for cleaning.",
        ],
      },
      { kind: "p", text: "Managers can switch **Require inspection after cleaning** on or off at the top of the page." },
      { kind: "links", items: [{ href: "/housekeeping", label: "Open Housekeeping" }] },
    ],
  },
  {
    id: "statuses",
    group: "Daily work",
    title: "Room statuses (automatic)",
    icon: "refresh",
    summary: "Room status moves by itself as staff work. Nobody sets it by hand.",
    blocks: [
      {
        kind: "table",
        head: ["Status", "Caused by", "Next step"],
        rows: [
          ["Ready", "Cleaned (and inspected if required), empty, in service", "Check-in → Occupied"],
          ["Occupied", "Guest checked in", "Check-out → Needs cleaning"],
          ["Needs cleaning", "Guest checked out (cleaning task created)", "Start cleaning"],
          ["Cleaning", "Housekeeper started", "Done"],
          ["Awaiting inspection", "Cleaning done, inspection required", "Pass → Ready"],
          ["Out of service", "Room set to Out of order / Maintenance / Inactive", "Set back to Active"],
        ],
      },
      { kind: "p", text: "Staff pages refresh themselves every 30 to 60 seconds, so everybody sees the same status." },
    ],
  },
  {
    id: "guest-view",
    group: "Daily work",
    title: "What the guest sees",
    icon: "phone",
    summary: "The guest's side, so you can explain it at check-in.",
    blocks: [
      {
        kind: "steps",
        items: [
          "Scan the room QR code with the phone camera. Your hotel page opens in your design.",
          "Read the welcome, Wi-Fi details, phone numbers and times; swipe the photos.",
          "Tap a service, choose options, add a note and tap **Send**.",
          "Watch the status page update: Request sent → Hotel team notified → Being handled → Completed.",
          "Order food or laundry and pay on delivery, or charge it to the room while checked in.",
          "When a request is **Completed**, the same page asks **How did we do?**: tap 1–5 stars and optionally write a comment.",
        ],
      },
      { kind: "tip", text: "Tell guests at check-in: \"Scan the code by your bed for Wi-Fi, water, towels, food or anything else.\"" },
    ],
  },
  {
    id: "reports",
    group: "Manage the business",
    title: "Reports and audit log",
    icon: "chart",
    summary: "Response times, occupancy, revenue, guest ratings, Excel downloads and who did what.",
    permissions: ["report.view", "audit.view"],
    blocks: [
      {
        kind: "list",
        items: [
          "**Reports**: requests by department, average acknowledgement and completion time, missed targets, occupancy, revenue, guest ratings, requests completed and rooms cleaned per staff member.",
          "**Download for Excel**: under the dates on Reports, click **Requests**, **Occupancy** or **Revenue** to download a CSV file for the chosen property and dates. It opens in Excel or Google Sheets.",
          "**Guest ratings**: average stars, how many completed requests were rated, stars by department, and the latest ratings of 3 stars or less with the guest's comment (click one to open the request).",
          "**Portfolio** (several properties): compare properties side by side.",
          "**Audit log**: every important change, who made it and when. Guest personal details are never written there.",
        ],
      },
    ],
  },
  {
    id: "billing",
    group: "Manage the business",
    title: "Your plan and account status",
    icon: "card",
    summary: "Trial, paid, past due and suspended explained.",
    permissions: ["billing.view"],
    blocks: [
      {
        kind: "table",
        head: ["Status", "Meaning", "Can you work?"],
        rows: [
          ["Trialing", "Free trial (14 days from first use)", "Yes"],
          ["Active", "Paid", "Yes"],
          ["Past due", "Trial or paid period ended, 7-day grace", "Yes, with a warning"],
          ["Suspended", "Grace ended, or suspended by the platform", "Read-only; guests can't send requests"],
          ["Cancelled", "Account closed", "Read-only"],
        ],
      },
      {
        kind: "p",
        text: "The **Billing** page shows your plan, its limits (properties, rooms, staff seats) and receipts. To pay or change plan, contact the platform team; they mark your account paid after a bank transfer or cash payment. Nothing is deleted while suspended.",
      },
    ],
  },
  {
    id: "hotel-settings",
    group: "Manage the business",
    title: "Hotel settings and integrations",
    icon: "settings",
    summary: "Company details, data export, API keys and webhooks.",
    permissions: ["tenant.manage"],
    blocks: [
      {
        kind: "list",
        items: [
          "**Hotel settings**: hotel display name, legal / business name and contact email.",
          "**Export your data**: download your hotel's data.",
          "**Integrations** (on plans that include it): create API keys and webhooks to connect your PMS or other tools. A key is shown once: copy it straight away.",
        ],
      },
    ],
  },
  {
    id: "my-account",
    group: "Your account",
    title: "Your profile, password and notifications",
    icon: "user",
    summary: "Change your password, turn on two-step sign-in and choose alerts.",
    blocks: [
      {
        kind: "list",
        items: [
          "Click your name at the bottom of the menu to open **My profile**.",
          "**Change password**: current password, then the new one (at least 10 characters).",
          "**Two-step sign-in**: add an authenticator app for extra safety.",
          "**Notifications**: phone alerts for new requests, only assigned ones, escalations, and WhatsApp alerts when enabled. Use **Test notification** to check.",
          "Working for more than one hotel? Use **Switch hotel** to change between them.",
        ],
      },
      { kind: "warn", text: "Never share your login. Each person needs their own account so the audit log stays accurate." },
    ],
  },
  {
    id: "faq",
    group: "Help",
    title: "Problems and quick fixes",
    icon: "help",
    summary: "The most common questions from hotel teams.",
    blocks: [
      {
        kind: "table",
        head: ["Problem", "Fix"],
        rows: [
          ["Guest sees \"unavailable\" after scanning", "The code was replaced or deactivated, the guest page is off, or the account is suspended. Check the room's QR card and the Guest portal tab."],
          ["A room is missing at check-in", "It isn't Ready. Finish cleaning/inspection on Housekeeping or set the room back to Active."],
          ["I don't see some requests", "Your role or property doesn't cover that department. Ask the owner to check Staff → your name."],
          ["Forgot password", "Ask your hotel owner or the platform team for a reset link."],
          ["Photo upload fails", "Use JPG, PNG or WebP. The gallery holds up to 20 photos."],
          ["\"Read-only\" message", "The account is suspended or past grace. The owner should check Billing."],
          ["Request count doesn't change", "Pages refresh every 10 to 30 seconds. Reload if needed."],
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// Super admin guide (platform owner)
// ---------------------------------------------------------------------------------------------

const PLATFORM_SECTIONS: GuideSection[] = [
  {
    id: "platform-overview",
    group: "Start here",
    title: "What the super admin does",
    icon: "shield",
    summary: "You run the platform: every hotel, plan, login and payment.",
    blocks: [
      {
        kind: "table",
        head: ["Console page", "What it's for"],
        rows: [
          ["Overview", "Totals: hotels by status, users, requests, recent activity"],
          ["Hotels", "Search and filter all hotels, create a new hotel, manage each one"],
          ["Users & staff", "Every login on the platform: block/unblock, make or remove super admins"],
          ["Plans", "Plan prices and limits (properties, rooms, staff, modules)"],
          ["Audit log", "Every super admin action with its reason and time"],
          ["Support", "Password reset links and two-step sign-in resets"],
          ["Docs & guide", "This guide, plus the full hotel guide"],
        ],
      },
      { kind: "warn", text: "Every super admin action is audited. Always give a real reason: it is what you will read later when something is questioned." },
    ],
  },
  {
    id: "platform-first-setup",
    group: "Start here",
    title: "First sign-in and two-step sign-in",
    icon: "lock",
    summary: "The console only opens after two-step sign-in is set up.",
    blocks: [
      {
        kind: "steps",
        items: [
          "Sign in at /login with the super admin email and password. You are sent to the console.",
          "The first time, you are asked to set up two-step sign-in (Security link at the top).",
          "Scan the QR code with Google Authenticator, Microsoft Authenticator or Authy and type the 6-digit code.",
          "From now on every sign-in asks for the code after your password.",
        ],
      },
      {
        kind: "tip",
        text: "Create a second super admin (Users & staff → Make super admin). A super admin can't reset their own two-step sign-in, so a second one can rescue a lost phone.",
      },
      { kind: "links", items: [{ href: "/account/security", label: "Open Security" }] },
    ],
  },
  {
    id: "platform-create-hotel",
    group: "Hotels",
    title: "Create a hotel",
    icon: "plus",
    summary: "Hotels can sign up themselves, or you create them for the owner.",
    blocks: [
      {
        kind: "p",
        text: "**Self sign-up**: the owner opens /signup, enters their name, work email, password, hotel name and legal name, and starts a free trial at once.",
      },
      {
        kind: "steps",
        items: [
          "**Created by you**: Hotels → **New hotel**.",
          "Enter hotel display name, legal / business name, plan, owner name and owner email.",
          "Click **Create**. A one-time link is shown.",
          "Send the link privately to the owner. They choose their own password and sign in as Hotel Owner.",
          "Point them to **Help & guide** in their menu: the setup checklist takes them through the rest.",
        ],
      },
      { kind: "links", items: [{ href: "/platform/tenants/new", label: "Create a hotel" }] },
    ],
  },
  {
    id: "platform-manage-hotel",
    group: "Hotels",
    title: "Manage a hotel",
    icon: "building",
    summary: "Everything about one hotel lives on its Manage page.",
    blocks: [
      {
        kind: "steps",
        items: [
          "Hotels → search by name or filter by status → **Manage**.",
          "See its plan, status, trial end, properties, rooms, staff and recent activity.",
          "**Edit hotel details** (names, contact) from the bottom card.",
          "Change plan, extend the trial, mark as paid or suspend from the subscription and status cards (see the next section).",
          "Deactivate or reactivate a staff member of that hotel from its staff list (the last owner can't be removed).",
        ],
      },
      { kind: "links", items: [{ href: "/platform/tenants", label: "Open Hotels" }] },
    ],
  },
  {
    id: "platform-account-status",
    group: "Hotels",
    title: "Account status: trial, paid, suspended",
    icon: "card",
    summary: "What each status means and how to change it.",
    blocks: [
      {
        kind: "table",
        head: ["Status", "Meaning", "Hotel can work?"],
        rows: [
          ["Trialing", "Free trial (14 days from first use)", "Yes"],
          ["Active", "Paid", "Yes"],
          ["Past due", "Period ended, 7-day grace", "Yes, with a banner"],
          ["Suspended", "Grace over, or you suspended it", "Read-only; guests can't send requests"],
          ["Cancelled", "Closed", "Read-only"],
        ],
      },
      {
        kind: "table",
        head: ["To do this", "On the hotel's Manage page", "Result"],
        rows: [
          ["Record a payment (cash, bank, free)", "Mark as paid: days + receipt/reason → Activate", "Active for those days"],
          ["Give more trial time", "Extend free trial: 1 to 90 days + reason", "Still Trialing, later end"],
          ["Change package", "Change plan + reason", "New plan, same status"],
          ["Block the hotel", "Suspend hotel", "Suspended, nothing deleted"],
          ["Unblock", "Reactivate", "Back to what the subscription allows"],
        ],
      },
      { kind: "p", text: "Statuses also change on their own: trial ends → Past due → after 7 days Suspended; a payment makes it Active." },
      { kind: "tip", text: "Online payment (Razorpay) is built but switched off until Razorpay keys are added. Until then, use Mark as paid." },
    ],
  },
  {
    id: "platform-enter-hotel",
    group: "Hotels",
    title: "Enter any hotel (admin, read-only, guest)",
    icon: "door",
    summary: "Help a hotel by working inside its account, or test a room as a guest.",
    blocks: [
      {
        kind: "table",
        head: ["Button on the Manage page", "What you get", "Banner"],
        rows: [
          ["Log in as hotel admin", "Full owner-level access for 1 hour", "Red"],
          ["View hotel (read-only)", "See every screen, change nothing, 1 hour", "Yellow"],
          ["Open as a guest", "List of every room; tap one to open its real guest page", "None"],
        ],
      },
      {
        kind: "steps",
        items: [
          "Type a short reason (for example \"Owner asked to fix room types\") and click the button.",
          "Work in the hotel as usual. Every change is recorded under your name.",
          "Click **Exit to super admin** in the banner when done. Signing out also ends it; it ends by itself after 1 hour.",
        ],
      },
      { kind: "warn", text: "Requests sent from a guest page reach the hotel's real staff. Use \"Something else\" with a note like \"Test from support\"." },
    ],
  },
  {
    id: "platform-users",
    group: "People",
    title: "Users and super admins",
    icon: "users",
    summary: "Every login on the platform, across all hotels.",
    blocks: [
      {
        kind: "list",
        items: [
          "Search by name or email; see each person's hotels, roles and last sign-in.",
          "**Block login** signs a person out everywhere and stops them signing in. **Unblock login** undoes it. You can't block yourself.",
          "**Make super admin** / **Remove super admin** controls who can open this console.",
        ],
      },
      { kind: "links", items: [{ href: "/platform/users", label: "Open Users & staff" }] },
    ],
  },
  {
    id: "platform-support",
    group: "People",
    title: "Support: passwords and lost phones",
    icon: "help",
    summary: "Recover access safely.",
    blocks: [
      {
        kind: "steps",
        items: [
          "Confirm who is asking, outside the system: call the hotel's known number, or the owner confirms.",
          "**Forgot password**: Support → create a reset link (valid 1 hour, single use) and send it privately.",
          "**Lost authenticator**: Support → **Reset two-step sign-in**. They set it up again at next sign-in.",
        ],
      },
      { kind: "links", items: [{ href: "/platform/support", label: "Open Support" }] },
    ],
  },
  {
    id: "platform-plans",
    group: "Business",
    title: "Plans and limits",
    icon: "chart",
    summary: "What each plan includes.",
    blocks: [
      {
        kind: "p",
        text: "The **Plans** page lists each plan with its price and limits: properties, rooms, staff seats and modules (ordering, integrations…). A hotel over its limit can keep working but can't add more until it upgrades.",
      },
      { kind: "links", items: [{ href: "/platform/plans", label: "Open Plans" }] },
    ],
  },
  {
    id: "platform-audit",
    group: "Business",
    title: "Audit log",
    icon: "list-checks",
    summary: "A permanent record of what super admins did.",
    blocks: [
      {
        kind: "p",
        text: "Every hotel created, plan changed, payment marked, suspension, user blocked, reset link and hotel entry is listed with who, when and the reason. Changes made inside a hotel while logged in as its admin also appear in that hotel's own audit log.",
      },
      { kind: "links", items: [{ href: "/platform/audit", label: "Open Audit log" }] },
    ],
  },
  {
    id: "platform-go-live",
    group: "Business",
    title: "Going-live checklist",
    icon: "rocket",
    summary: "Do these before the first paying hotel.",
    blocks: [
      {
        kind: "list",
        items: [
          "Change every demo or shared password.",
          "Rotate the database password and keep a separate database for previews.",
          "Add a custom domain **before** printing QR codes (printed codes keep their address).",
          "Add Razorpay keys and set real plan prices.",
          "Optional: SMS/WhatsApp alerts (Twilio) and an email provider for invitations.",
          "Upload real photos and a design for each demo hotel you show customers.",
        ],
      },
    ],
  },
];

const img = (name: string, caption: string, phone = false): GuideMedia => ({ type: "image", src: `/guide/${name}.jpg`, caption, phone });
const vid = (name: string, caption: string, phone = false): GuideMedia => ({ type: "video", src: `/guide/${name}.webm`, caption, phone });

/** Screens and recordings per section; shown after the text, before the "Open …" buttons. */
const HOTEL_MEDIA: Record<string, GuideMedia[]> = {
  "getting-started": [vid("video-tour", "Video: a quick tour of every menu"), img("dashboard", "The Dashboard after signing in")],
  "property-setup": [img("properties", "Properties list"), img("rooms", "A property's Rooms tab with floors, types and statuses")],
  "qr-codes": [img("qr-codes", "QR codes tab: Print sheet and scan counts per room"), img("room-qr", "One room's QR card: download, replace or deactivate")],
  services: [img("services", "Services tab: edit what guests can ask for")],
  "guest-page": [
    vid("video-design", "Video: trying templates and colour palettes with the live preview"),
    img("guest-portal", "Guest portal tab: Wi-Fi, contacts and times"),
    img("design", "Design & photos tab with the phone preview"),
    img("guest-services", "Result: service tiles with photos on the guest page", true),
  ],
  staff: [img("staff", "Staff page: invite form and team list")],
  reservations: [img("reservations", "Reservations: new booking and availability")],
  "front-desk": [img("front-desk", "Front desk: arrivals and walk-in check-in")],
  requests: [vid("video-staff-request", "Video: Accept → Start → Complete a request"), img("requests", "Requests list")],
  housekeeping: [img("housekeeping", "Housekeeping board")],
  "guest-view": [
    vid("video-guest-request", "Video: a guest scans and sends a request", true),
    img("guest-home", "Guest page after scanning", true),
    img("guest-services", "Service tiles with photos", true),
    img("guest-request", "Request form", true),
  ],
  reports: [img("reports", "Reports page")],
  billing: [img("billing", "Billing page: plan, limits and receipts")],
  "my-account": [img("profile", "My profile: password, two-step sign-in and notifications")],
};

function withMedia(sections: GuideSection[], media: Record<string, GuideMedia[]>): GuideSection[] {
  return sections.map((s) => {
    const items = media[s.id];
    if (!items?.length) return s;
    const at = s.blocks.findIndex((b) => b.kind === "links");
    const blocks = [...s.blocks];
    blocks.splice(at === -1 ? blocks.length : at, 0, { kind: "media", items });
    return { ...s, blocks };
  });
}

export const HOTEL_GUIDE: Guide = {
  key: "hotel",
  title: "Hotel guide",
  intro: "Everything your team needs to run guest services: set-up, daily work and fixes. Use the search box or the contents list.",
  journey: [
    { title: "Add property & rooms", text: "Floors, room types, rooms", section: "property-setup" },
    { title: "Services & design", text: "What guests can ask for, and the look", section: "services" },
    { title: "Print QR codes", text: "One sticker per room", section: "qr-codes" },
    { title: "Invite staff", text: "A login and role for each person", section: "staff" },
    { title: "Check guests in", text: "Front desk", section: "front-desk" },
    { title: "Handle requests", text: "Accept → Start → Complete", section: "requests" },
  ],
  sections: withMedia(HOTEL_SECTIONS, HOTEL_MEDIA),
};

export const PLATFORM_GUIDE: Guide = {
  key: "platform",
  title: "Super admin guide",
  intro: "How to run the platform: create and manage hotels, plans, payments, users and support.",
  journey: [
    { title: "Secure your login", text: "Two-step sign-in", section: "platform-first-setup" },
    { title: "Create a hotel", text: "Or let it sign up", section: "platform-create-hotel" },
    { title: "Set the plan & status", text: "Trial, paid, suspended", section: "platform-account-status" },
    { title: "Help a hotel", text: "Log in as admin or guest", section: "platform-enter-hotel" },
    { title: "Support people", text: "Resets and blocks", section: "platform-support" },
  ],
  sections: withMedia(PLATFORM_SECTIONS, {
    "platform-enter-hotel": [img("guest-home", "What you see with Open as a guest (room page)", true), img("dashboard", "A hotel's workspace after Log in as hotel admin")],
  }),
};

/** Hotel sections a staff member should see: any listed permission, or none listed. */
export function sectionsFor(sections: GuideSection[], has: (p: PermissionKey) => boolean): GuideSection[] {
  return sections.filter((s) => !s.permissions || s.permissions.some(has));
}
