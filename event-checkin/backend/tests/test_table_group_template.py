"""The downloadable guest template carries the `table_group` column for events
that use seating, and a filled template round-trips through upload + the shared
sync ingestion (auto-creating/assigning groups)."""
import csv
import io

import pytest
from sqlalchemy import select, func

from app.models import Event, TableGroup, Guest
from app.routers.guests import _process_csv
from conftest import _Session


async def _enable_seating(event_id):
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.seating_enabled = True
        await s.commit()


@pytest.mark.asyncio
async def test_csv_template_includes_table_group_for_seating_event(ctx):
    await _enable_seating(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]

    r = await ctx.client.get(f"/api/events/{ev}/guests/template?fmt=csv")
    assert r.status_code == 200
    rows = list(csv.reader(io.StringIO(r.text)))
    header, sample = rows[0], rows[1]
    assert "table_group" in header
    # Sample row documents the column with a usable example value.
    assert sample[header.index("table_group")] == "VIP Tables"


@pytest.mark.asyncio
async def test_csv_template_omits_table_group_without_seating(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]   # seating disabled by default
    r = await ctx.client.get(f"/api/events/{ev}/guests/template?fmt=csv")
    header = next(csv.reader(io.StringIO(r.text)))
    assert "table_group" not in header


@pytest.mark.asyncio
async def test_xlsx_template_includes_table_group(ctx):
    await _enable_seating(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    r = await ctx.client.get(f"/api/events/{ev}/guests/template?fmt=xlsx")
    assert r.status_code == 200
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    header = [c.value for c in wb["Guests"][1]]
    assert "table_group" in header


@pytest.mark.asyncio
async def test_download_then_upload_roundtrip(ctx):
    """Download the template, fill it like a client would, upload it back."""
    await _enable_seating(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]

    tmpl = await ctx.client.get(f"/api/events/{ev}/guests/template?fmt=csv")
    header = next(csv.reader(io.StringIO(tmpl.text)))

    # Build two data rows from the real header (so column order can't drift).
    def row(values):
        return ",".join(values.get(h, "") for h in header)
    filled = "\n".join([
        ",".join(header),
        row({"first_name": "Mary", "last_name": "Vip", "email": "mary@x.com", "table_group": "VIP Tables"}),
        row({"first_name": "Joe", "last_name": "Spon", "email": "joe@x.com", "table_group": "Sponsor Tables"}),
    ]) + "\n"

    res = (await ctx.client.post(f"/api/events/{ev}/guests/upload",
           files={"file": ("filled.csv", filled, "text/csv")})).json()
    assert res["added"] == 2
    assert res.get("table_groups_created") == 2
    assert res.get("table_groups_assigned") == 2

    guests = (await ctx.client.get(f"/api/events/{ev}/guests")).json()
    mary = next(g for g in guests if g["first_name"] == "Mary")
    assert mary["table_group_name"] == "VIP Tables"


@pytest.mark.asyncio
async def test_sync_ingestion_assigns_groups(ctx):
    """Google Sheets / OneDrive sync funnels through the same _process_csv, so a
    synced sheet with a table_group column assigns + auto-creates groups too."""
    await _enable_seating(ctx.ids["event_a"])
    ev = ctx.ids["event_a"]
    sheet = ("first_name,last_name,email,table_group\n"
             "Ada,Synced,ada.sync@x.com,Press Tables\n")
    async with _Session() as s:
        res = await _process_csv(sheet, ev, s)
    assert res.get("table_groups_created") == 1
    assert res.get("table_groups_assigned") == 1

    async with _Session() as s:
        grp = await s.scalar(select(TableGroup).where(TableGroup.event_id == ev))
        g = await s.scalar(select(Guest).where(Guest.email == "ada.sync@x.com"))
    assert grp is not None and g.assigned_table_group_id == grp.id


@pytest.mark.asyncio
async def test_import_tolerates_missing_group_and_email(ctx):
    """Empty table_group and empty email must NOT fail the import — only
    first_name + last_name are required. Blank rows are skipped, not errored."""
    await _enable_seating(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]

    csv_text = (
        "first_name,last_name,email,phone,table_group\n"
        "Nora,NoGroup,nora@x.com,,\n"          # has email, no group
        "Phil,PhoneOnly,,+18325550111,\n"      # no email, no group
        "Quinn,Quiet,,,\n"                      # no email, no phone, no group
        "Vee,Vip,vee@x.com,,VIP Tables\n"       # fully specified (sanity)
        ",,,,\n"                                 # blank row → skipped
    )
    res = (await ctx.client.post(f"/api/events/{ev}/guests/upload",
           files={"file": ("g.csv", csv_text, "text/csv")})).json()

    assert "detail" not in res          # no error raised
    assert res["added"] == 4            # the 4 named rows imported
    assert res.get("table_groups_assigned") == 1   # only Vee got a group

    guests = (await ctx.client.get(f"/api/events/{ev}/guests")).json()
    by = {g["first_name"]: g for g in guests}
    assert by["Nora"]["table_group_name"] is None
    assert by["Phil"]["email"] is None and by["Phil"]["table_group_name"] is None
    assert by["Quinn"]["email"] is None
    assert by["Vee"]["table_group_name"] == "VIP Tables"
    assert "Quinn" in by  # blank-row skip didn't drop the valid rows


@pytest.mark.asyncio
async def test_reimport_does_not_duplicate_or_reassign(ctx):
    """Re-syncing the same sheet is idempotent: no duplicate group, no clobber."""
    await _enable_seating(ctx.ids["event_a"])
    ev = ctx.ids["event_a"]
    sheet = ("first_name,last_name,email,table_group\n"
             "Re,Peat,re@x.com,Family Tables\n")
    async with _Session() as s:
        await _process_csv(sheet, ev, s)
    async with _Session() as s:
        res2 = await _process_csv(sheet, ev, s)
    assert res2.get("table_groups_created") is None      # not created again
    async with _Session() as s:
        n = await s.scalar(select(func.count()).select_from(TableGroup).where(TableGroup.event_id == ev))
    assert n == 1
