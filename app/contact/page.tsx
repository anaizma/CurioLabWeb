"use client";

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <p className="label mb-3">Get in touch</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">Contact</h1>
      <p className="text-muted max-w-xl mb-12">
        Questions about applying, mentoring, sponsoring, or starting a
        chapter — reach out and someone will get back to you ASAP.
      </p>

      <div className="grid md:grid-cols-2 gap-8 mb-16">
        <div className="bg-white border border-black/10 rounded-xl p-6">
          <p className="label mb-2">Email</p>
          <a href="mailto:hello@curiolab.org" className="font-medium hover:underline">
            aizma@curiolab.org
          </a>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-6">
          <p className="label mb-2">Locations</p>
          <p className="font-medium">Cleveland, OH</p>
        </div>
      </div>

      <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
        <div>
          <label className="label block mb-2">Name</label>
          <input className="w-full border border-black/20 rounded-md px-4 py-3 bg-white" type="text" required />
        </div>
        <div>
          <label className="label block mb-2">Email</label>
          <input className="w-full border border-black/20 rounded-md px-4 py-3 bg-white" type="email" required />
        </div>
        <div>
          <label className="label block mb-2">Message</label>
          <textarea className="w-full border border-black/20 rounded-md px-4 py-3 bg-white" rows={5} required />
        </div>
        <button type="submit" className="bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors">
          Send message
        </button>
        <p className="text-xs text-muted">
         Need to hook this form up with resend still...
        </p>
      </form>
    </div>
  );
}