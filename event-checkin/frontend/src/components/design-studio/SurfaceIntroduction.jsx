const introductions = {
  Templates: ['A look that feels like you.', 'Explore a collection, preview your event, and make it your own.'],
  GuestHub: ['Everything, beautifully together.', 'Give guests one welcoming place for their programme, pass, and event details.'],
  Flyer: ['Made to be shared.', 'Shape your artwork, refine the details, and preview the finished piece.'],
  'Event Page': ['A welcome worth opening.', 'Choose the details guests see when they open their invitation.'],
  'Festio Pass': ['Your event, in their pocket.', 'Make every guest’s personal pass clear, recognisable, and easy to use.'],
  FestioHub: ['A place to belong.', 'Create a connected guest experience with a style that feels like your event.'],
  Certificates: ['A moment worth recognising.', 'Design a keepsake, set eligibility, and recognise participation.'],
  'Email Preview': ['A thoughtful first hello.', 'See how your event’s identity carries through every kind of email.'],
  Publish: ['Ready for your guests.', 'Review the details, check your previews, and publish when you’re ready.'],
}
export default function SurfaceIntroduction({ surface }) {
  const introduction = introductions[surface]
  if (!introduction) return null
  return <header className="ds-surface-intro"><div><p className="ds-surface-eyebrow">DESIGN STUDIO / {surface}</p><h2>{introduction[0]}</h2></div><p>{introduction[1]}</p></header>
}
