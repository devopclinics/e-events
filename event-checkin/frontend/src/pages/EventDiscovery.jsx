import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import './EventDiscovery.css'

const price = (event) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: event.currency,
  }).format(Number(event.from_price || 0) / 100)
const eventTime = (event) => {
  const value = new Date(event.event_date).getTime()
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}
function eventDate(event, options = {}) {
  if (!Number.isFinite(new Date(event.event_date).getTime()))
    return 'Date to be announced'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: event.timezone || 'UTC',
    ...options,
  }).format(new Date(event.event_date))
}
const eventUrl = (event) =>
  event.sales_url || `/tickets/e/${encodeURIComponent(event.id)}`

function Icon({ name, ...props }) {
  const paths = {
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    pin: (
      <>
        <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    arrow: (
      <>
        <path d="M4 12h16m-6-6 6 6-6 6" />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="16" rx="3" />
        <path d="M8 3v4m8-4v4M4 11h16m-11 5h6" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    moon: <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z" />,
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}

function Artwork({ event, priority = false }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [event.cover_image])
  return event.cover_image && !failed ? (
    <img
      src={event.cover_image}
      alt=""
      loading={priority ? 'eager' : 'lazy'}
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="ptd-art-fallback" aria-hidden="true">
      <span>F</span>
      <i>A moment to look forward to.</i>
    </div>
  )
}

function DiscoveryCard({ event }) {
  return (
    <article className="ptd-card">
      <a href={eventUrl(event)}>
        <div className="ptd-card-art">
          <Artwork event={event} />
          <span
            className={`ptd-status${event.timing === 'current' ? ' is-live' : ''}`}
          >
            {event.timing === 'current' ? 'Happening now' : 'Coming up'}
          </span>
        </div>
        <div className="ptd-card-content">
          <div className="ptd-card-date">
            <Icon name="calendar" />
            <time dateTime={event.event_date}>
              {eventDate(event, { weekday: 'short' })}
            </time>
          </div>
          {event.event_type && (
            <span className="ptd-type">{event.event_type}</span>
          )}
          <h3>{event.name}</h3>
          <p className="ptd-location">
            <Icon name="pin" />
            <span>
              {event.venue_name ||
                event.venue_address ||
                'Location from organizer'}
            </span>
          </p>
          {event.organizer_name && (
            <p className="ptd-organizer">By {event.organizer_name}</p>
          )}
          <div className="ptd-card-bottom">
            <span>
              <small>Tickets from</small>
              <strong>{price(event)}</strong>
            </span>
            <span className="ptd-card-action">
              View event <Icon name="arrow" />
            </span>
          </div>
        </div>
      </a>
    </article>
  )
}

export default function EventDiscovery({ events, loadError, onRetry }) {
  const { dark, toggle } = useTheme()
  const [query, setQuery] = useState('')
  const [timing, setTiming] = useState('all')
  const [type, setType] = useState('all')
  const [sort, setSort] = useState('soonest')
  useEffect(() => {
    if (
      events &&
      type !== 'all' &&
      !events.some((event) => event.event_type === type)
    )
      setType('all')
  }, [events, type])
  useEffect(() => {
    const previous = document.title
    document.title = 'Discover events & experiences | Festio'
    return () => {
      document.title = previous
    }
  }, [])
  const allEvents = [...(events || [])].sort(
    (a, b) => eventTime(a) - eventTime(b),
  )
  const featured =
    allEvents.find((event) => event.timing === 'current') || allEvents[0]
  const types = [
    ...new Set(allEvents.map((event) => event.event_type).filter(Boolean)),
  ].sort()
  const search = query.trim().toLocaleLowerCase()
  const visible = allEvents
    .filter(
      (event) =>
        `${event.name} ${event.venue_name || ''} ${event.venue_address || ''} ${event.organizer_name || ''} ${event.event_type || ''}`
          .toLocaleLowerCase()
          .includes(search) &&
        (timing === 'all' ||
          (timing === 'current'
            ? event.timing === 'current'
            : event.timing !== 'current')) &&
        (type === 'all' || event.event_type === type),
    )
    .sort((a, b) =>
      sort === 'latest'
        ? eventTime(b) - eventTime(a)
        : eventTime(a) - eventTime(b),
    )
  const current = visible.filter((event) => event.timing === 'current')
  const upcoming = visible.filter((event) => event.timing !== 'current')
  const reset = () => {
    setQuery('')
    setTiming('all')
    setType('all')
  }
  function searchEvents(e) {
    e.preventDefault()
    document
      .getElementById('event-list')
      ?.scrollIntoView({ behavior: 'instant', block: 'start' })
  }
  function group(items, title, eyebrow) {
    return (
      items.length > 0 && (
        <section className="ptd-event-group" aria-label={title}>
          <div className="ptd-group-title">
            <div>
              <span className="ptd-eyebrow">{eyebrow}</span>
              <h2>{title}</h2>
            </div>
            <span>
              {items.length} event{items.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="ptd-grid">
            {items.map((event) => (
              <DiscoveryCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )
    )
  }
  return (
    <main className="pt-discover">
      <nav className="ptd-nav" aria-label="Event discovery navigation">
        <div className="ptd-shell ptd-nav-inner">
          <Link className="ptd-brand" to="/" aria-label="Festio home">
            <span>F</span>Festio <small>Discover</small>
          </Link>
          <div className="ptd-nav-actions">
            <button
              className="ptd-theme"
              type="button"
              onClick={toggle}
              aria-label="Toggle theme"
            >
              <Icon name={dark ? 'sun' : 'moon'} />
            </button>
            <Link className="ptd-signin" to="/login">
              Sign in
            </Link>
            <Link
              className="ptd-button ptd-button-small"
              to="/register?redesign=1"
            >
              Create event <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
      </nav>
      <div className="ptd-shell">
        <header className="ptd-hero">
          <div className="ptd-hero-copy">
            <span className="ptd-eyebrow">A date worth keeping</span>
            <h1>
              Something to
              <br />
              <em>look forward to.</em>
            </h1>
            <p>
              Find your people. Discover a new experience. Make room in your
              calendar for a moment that matters.
            </p>
            <form className="ptd-search" role="search" onSubmit={searchEvents}>
              <Icon name="search" />
              <label className="ptd-sr-only" htmlFor="event-search">
                Search events
              </label>
              <input
                id="event-search"
                placeholder="Event, place or organizer…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                type="search"
              />
              <button type="submit" aria-label="Show search results">
                <Icon name="arrow" />
              </button>
            </form>
            <div className="ptd-hero-note">
              <span>Event details from organizers</span>
              <i aria-hidden="true">·</i>
              <span>Your next experience starts here</span>
            </div>
          </div>
          <div className="ptd-feature-stage">
            {featured ? (
              <a className="ptd-feature" href={eventUrl(featured)}>
                <div className="ptd-feature-art">
                  <Artwork event={featured} priority />
                </div>
                <div className="ptd-feature-caption">
                  <span className="ptd-eyebrow">
                    {featured.timing === 'current'
                      ? 'Happening now'
                      : 'Next on the calendar'}
                  </span>
                  <h2>{featured.name}</h2>
                  <p>
                    {eventDate(featured)}
                    <span aria-hidden="true"> · </span>
                    {featured.venue_name ||
                      featured.venue_address ||
                      'See event details'}
                  </p>
                  <span className="ptd-feature-link">
                    Explore this event <Icon name="arrow" />
                  </span>
                </div>
              </a>
            ) : (
              <div className="ptd-feature-placeholder" aria-hidden="true">
                <Icon name="calendar" width="65" height="65" />
                <p>
                  A little anticipation.
                  <br />A whole new experience.
                </p>
                <span>Discover with Festio</span>
              </div>
            )}
            <span className="ptd-stage-note" aria-hidden="true">
              Make a little room for something wonderful.
            </span>
          </div>
        </header>
        <div className="ptd-browse" id="event-list">
          <div className="ptd-browse-title">
            <div>
              <span className="ptd-eyebrow">
                Your calendar, with possibilities
              </span>
              <h2>Find your next experience.</h2>
            </div>
            <p aria-live="polite">
              {events === null
                ? 'Finding events…'
                : loadError
                  ? 'Events temporarily unavailable'
                  : `${visible.length} event${visible.length === 1 ? '' : 's'} to explore`}
            </p>
          </div>
          <div className="ptd-toolbar">
            <div
              className="ptd-filters"
              role="group"
              aria-label="Filter events by timing"
            >
              {[
                ['all', 'All events'],
                ['upcoming', 'Coming up'],
                ['current', 'Happening now'],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={timing === value}
                  className={timing === value ? 'active' : ''}
                  onClick={() => setTiming(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="ptd-selects">
              {types.length > 1 && (
                <label>
                  <span className="ptd-sr-only">Event type</span>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    <option value="all">All event types</option>
                    {types.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <span className="ptd-sr-only">Sort events</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="soonest">Soonest first</option>
                  <option value="latest">Latest first</option>
                </select>
              </label>
            </div>
          </div>
          {events === null ? (
            <div className="ptd-loading" role="status">
              <span className="ptd-loading-dot" />
              Finding your next experience…
            </div>
          ) : loadError ? (
            <div className="ptd-empty" role="alert">
              <Icon name="calendar" />
              <h3>Let’s try that again.</h3>
              <p>
                We couldn’t load the events right now. Please check your
                connection and retry.
              </p>
              <button type="button" className="ptd-button" onClick={onRetry}>
                Try again
              </button>
            </div>
          ) : allEvents.length === 0 ? (
            <div className="ptd-empty">
              <Icon name="calendar" />
              <h3>Good things are on the way.</h3>
              <p>
                No ticketed events are listed right now. Check back soon for new
                experiences.
              </p>
              <Link className="ptd-button" to="/">
                Explore Festio
              </Link>
            </div>
          ) : visible.length === 0 ? (
            <div className="ptd-empty">
              <Icon name="search" />
              <h3>A different search, perhaps?</h3>
              <p>
                Try another event, place or organizer, or clear your filters.
              </p>
              <button type="button" className="ptd-button" onClick={reset}>
                Clear search & filters
              </button>
            </div>
          ) : (
            <>
              {group(current, 'Happening now', 'Be part of the moment')}
              {group(upcoming, 'Coming up', 'Something to look forward to')}
            </>
          )}
        </div>
        <section className="ptd-host">
          <div>
            <span className="ptd-eyebrow">Bring your own people together</span>
            <h2>
              Your event could be
              <br />
              <em>someone’s next great memory.</em>
            </h2>
            <p>
              Create your event, shape the guest experience, and publish ticket
              sales when you’re ready.
            </p>
          </div>
          <Link className="ptd-button" to="/register?redesign=1">
            Create your event <Icon name="arrow" />
          </Link>
        </section>
        <footer className="ptd-footer">
          <Link className="ptd-brand" to="/">
            <span>F</span>Festio
          </Link>
          <p>A little more thoughtful. A lot more connected.</p>
          <div>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/#contact">Contact</Link>
          </div>
        </footer>
      </div>
    </main>
  )
}
