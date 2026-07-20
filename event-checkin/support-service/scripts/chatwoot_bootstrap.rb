# frozen_string_literal: true
#
# Idempotent one-time Chatwoot bootstrap. Creates (or finds, on re-run) the
# support account, an admin agent, a Website inbox with Identity Validation
# enabled, an Agent Bot + API access token, and the support-service webhook
# subscription — everything `support-service`'s five CHATWOOT_* env vars
# need, without a manual click-through of the setup wizard.
#
# Run inside the chatwoot container via `rails runner` reading from stdin —
# see scripts/bootstrap_chatwoot.sh, which pipes this file in over
# `kubectl exec -i`. Safe to re-run: every step finds-or-creates by a stable
# key instead of duplicating rows.
#
# NOTE ON DRIFT: this targets the `chatwoot/chatwoot:latest-ce` schema as of
# 2026-07. Chatwoot's internal ActiveRecord models are not a stable public
# API — if a step raises NoMethodError/ActiveRecord::StatementInvalid, the
# CE release moved a column/association. Diagnose with
# `bundle exec rails runner "puts Inbox.column_names"` (etc.) against the
# live container and patch this file rather than guessing further; the
# manual UI steps in README.md#one-time-chatwoot-bootstrap are the fallback.
#
# Prints exactly one line starting with "BOOTSTRAP_JSON:" containing the
# resulting values as JSON — the wrapper script greps for that prefix, so
# don't let application code print another line with that prefix.

require "json"
require "securerandom"

ACCOUNT_NAME       = ENV.fetch("BOOTSTRAP_ACCOUNT_NAME", "Festio Support")
INBOX_NAME         = ENV.fetch("BOOTSTRAP_INBOX_NAME", "Organizer Support")
ADMIN_EMAIL        = ENV.fetch("BOOTSTRAP_ADMIN_EMAIL") { abort("BOOTSTRAP_ADMIN_EMAIL is required") }
ADMIN_NAME         = ENV.fetch("BOOTSTRAP_ADMIN_NAME", "Festio Ops")
WEBHOOK_BASE_URL   = ENV.fetch("BOOTSTRAP_WEBHOOK_BASE_URL") { abort("BOOTSTRAP_WEBHOOK_BASE_URL is required") }
WEBSITE_URL        = ENV.fetch("BOOTSTRAP_WIDGET_WEBSITE_URL", "https://festio.events")

result = ActiveRecord::Base.transaction do
  account = Account.find_or_create_by!(name: ACCOUNT_NAME)

  admin_password = ENV["BOOTSTRAP_ADMIN_PASSWORD"].to_s.strip
  admin_password = SecureRandom.base58(20) if admin_password.empty?

  user = User.find_by(email: ADMIN_EMAIL)
  admin_password_generated = false
  if user.nil?
    user = User.create!(
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      password: admin_password,
      password_confirmation: admin_password
    )
    admin_password_generated = true
  end

  AccountUser.find_or_create_by!(account: account, user: user) do |au|
    au.role = :administrator
  end

  inbox = account.inboxes.joins(:channel).find_by(
    name: INBOX_NAME, "channels.type" => "Channel::WebWidget"
  )
  if inbox.nil?
    widget = Channel::WebWidget.create!(
      account: account,
      website_url: WEBSITE_URL,
      widget_color: "#0F766E",
      hmac_mandatory: true
    )
    inbox = Inbox.create!(account: account, name: INBOX_NAME, channel: widget)
  else
    widget = inbox.channel
    widget.update!(hmac_mandatory: true) unless widget.hmac_mandatory
  end
  widget.reload
  hmac_secret = widget.hmac_token

  agent_bot = AgentBot.find_or_create_by!(name: "Festio Support Bot") do |bot|
    bot.description = "Posts AI-drafted replies / private notes from support-service"
  end
  AgentBotInbox.find_or_create_by!(inbox: inbox, agent_bot: agent_bot)

  access_token = AccessToken.find_by(owner: agent_bot)
  access_token = AccessToken.create!(owner: agent_bot) if access_token.nil?

  webhook_token = ENV["BOOTSTRAP_WEBHOOK_TOKEN"].to_s.strip
  webhook_token = SecureRandom.hex(24) if webhook_token.empty?
  webhook_path_prefix = "#{WEBHOOK_BASE_URL.chomp('/')}/api/support/webhooks/chatwoot"
  webhook_url = "#{webhook_path_prefix}?token=#{webhook_token}"

  webhook = account.webhooks.detect { |w| w.url.start_with?(webhook_path_prefix) }
  if webhook.nil?
    Webhook.create!(account: account, url: webhook_url, subscriptions: ["message_created"])
  else
    webhook.update!(url: webhook_url, subscriptions: ["message_created"])
  end

  {
    CHATWOOT_ACCOUNT_ID: account.id,
    CHATWOOT_INBOX_ID: inbox.id,
    CHATWOOT_API_ACCESS_TOKEN: access_token.token,
    CHATWOOT_HMAC_SECRET: hmac_secret,
    CHATWOOT_WEBHOOK_TOKEN: webhook_token,
    admin_email: ADMIN_EMAIL,
    admin_password: admin_password_generated ? admin_password : "(unchanged — user already existed)"
  }
end

puts "BOOTSTRAP_JSON:#{result.to_json}"
