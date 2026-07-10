# Festio Sample Experience Guide

Use this sample to demo the new Experience workflow feature in an event such as a VIP dinner, gala, wedding reception, conference reception, or private celebration.

## Sample Event

**Event name:** Hafsat's 50th Birthday Dinner

**Goal:** give the host one operational view of each guest's journey from invitation through arrival, seating, meal handling, souvenir pickup, and departure.

**Recommended enabled features:**

- Event Pass / QR check-in
- RSVP with approval
- Seating
- Menu
- Guest communication
- Experience workflow

## Workflow Name

**VIP Dinner Guest Journey**

Create it in **Admin -> Event Setup -> Experience -> New workflow**.

## Workflow Steps

Add these steps in this order.

| Order | Step key | Type | Title | Required | Purpose |
| --- | --- | --- | --- | --- | --- |
| 10 | `rsvp_approved` | `custom` | RSVP approved | Yes | Confirms the guest is approved before day-of operations. |
| 20 | `main_check_in` | `check_in` | Main entrance check-in | Yes | Tracks QR or manual admission at the venue. |
| 30 | `seat_confirmed` | `seating_assignment` | Seat confirmed | Yes | Confirms the guest has a table and seat. |
| 40 | `meal_confirmed` | `meal_selection` | Meal confirmed | No | Tracks whether catering has the guest's meal choice. |
| 50 | `welcome_pack` | `custom` | Welcome pack collected | No | Staff marks gift bag, badge, or souvenir pickup complete. |
| 60 | `vip_host_greeting` | `custom` | Host greeting complete | No | Optional VIP-only step for family, sponsors, dignitaries, or special guests. |
| 70 | `checkout` | `custom` | Departure noted | No | Optional close-out step for valet, pickup, or post-event follow-up. |

## Suggested Step Details

### RSVP Approved

- **Type:** `custom`
- **Required:** yes
- **Description:** Guest has confirmed attendance and passed host approval.
- **Config JSON:**

```json
{
  "owner": "host",
  "source": "guest_rsvp",
  "visible_to_staff": true
}
```

### Main Entrance Check-in

- **Type:** `check_in`
- **Required:** yes
- **Description:** Admit the guest using their QR code or manual lookup.
- **Config JSON:**

```json
{
  "station": "main_entrance",
  "allow_manual_lookup": true,
  "requires_event_pass": true
}
```

### Seat Confirmed

- **Type:** `seating_assignment`
- **Required:** yes
- **Description:** Confirm the guest's table and seat before they enter the dining area.
- **Config JSON:**

```json
{
  "show_table_name": true,
  "show_seat_number": true,
  "staff_prompt": "Confirm table before sending guest into the hall."
}
```

### Meal Confirmed

- **Type:** `meal_selection`
- **Required:** no
- **Description:** Confirm catering has the guest's selected meal or dietary note.
- **Config JSON:**

```json
{
  "allow_staff_note": true,
  "fallback_choice": "Confirm at table"
}
```

### Welcome Pack Collected

- **Type:** `custom`
- **Required:** no
- **Description:** Mark complete when the guest collects their welcome pack, badge, souvenir, or gift bag.
- **Config JSON:**

```json
{
  "station": "gift_table",
  "item": "welcome_pack",
  "prevent_duplicate_collection": true
}
```

### VIP Host Greeting Complete

- **Type:** `custom`
- **Required:** no
- **Description:** Mark complete after the host or protocol team has greeted the guest.
- **Conditions JSON:**

```json
{
  "guest_tags_include": ["vip"]
}
```

**Config JSON:**

```json
{
  "owner": "protocol_team",
  "staff_prompt": "Notify host before marking this complete."
}
```

### Departure Noted

- **Type:** `custom`
- **Required:** no
- **Description:** Mark complete when valet, transport, or guest departure is handled.
- **Config JSON:**

```json
{
  "station": "exit",
  "allow_note": true
}
```

## Demo Guest Journey

Use three guests to show different outcomes:

| Guest | Scenario | Expected progress |
| --- | --- | --- |
| Aisha Bello | Regular approved guest | RSVP approved, checked in, seat confirmed, meal confirmed. |
| Tunde Adeyemi | VIP guest | All regular steps plus host greeting. |
| Maria Chen | Walk-in/manual lookup | Check-in available, seat may be blocked until assigned, welcome pack optional. |

## Host Demo Script

1. Open **Admin -> Event Setup -> Experience**.
2. Create **VIP Dinner Guest Journey**.
3. Add the steps above.
4. Publish the workflow.
5. Open the progress dashboard in the same panel.
6. Check in one guest through the normal scanner.
7. Return to **Experience** and show that the check-in step is reflected in workflow progress.
8. Mark custom operational steps complete as staff actions happen.

## What This Shows

- The scanner still works the same way.
- Existing seating and menu data can become journey steps.
- Hosts get one operational dashboard for the guest journey.
- Published workflows give the event team a stable runbook.
- Optional custom steps support real venue operations before dedicated step handlers exist.

## Current Implementation Notes

The first implementation supports workflow setup, step ordering, publishing, progress initialization, and dashboard visibility. The `check_in`, `seating_assignment`, and `meal_selection` step types can backfill progress from existing event data. Custom steps are suitable for guide/demo workflows until staff runtime completion controls are expanded.
