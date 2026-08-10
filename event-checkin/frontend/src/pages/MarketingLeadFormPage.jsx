import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import "./MarketingLeadFormPage.css";

export default function MarketingLeadFormPage() {
  const { token } = useParams();
  const [form, setForm] = useState(null),
    [values, setValues] = useState({}),
    [captcha, setCaptcha] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    api
      .marketingPublicForm(token)
      .then(setForm)
      .catch((reason) => setError(reason.message));
    window.festioLeadCaptcha = (value) => setCaptcha(value);
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    document.head.appendChild(script);
    return () => {
      delete window.festioLeadCaptcha;
      script.remove();
    };
  }, [token]);
  if (error)
    return (
      <main className="lead-form-page">
        <section>
          <h1>Form unavailable</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  if (!form)
    return (
      <main className="lead-form-page">
        <section>
          <p>Loading form…</p>
        </section>
      </main>
    );
  return (
    <main className="lead-form-page">
      <section>
        <span>FESTIO</span>
        <h1>{form.title}</h1>
        <p>{form.description}</p>
        {message ? (
          <div className="lead-form-success">{message}</div>
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              try {
                const result = await api.marketingSubmitPublicForm(token, {
                  ...values,
                  captcha_token: captcha,
                });
                setMessage(result.message);
              } catch (reason) {
                setError(reason.message);
              }
            }}
          >
            {form.fields.map((field) => (
              <label key={field}>
                {field.replaceAll("_", " ")}
                <input
                  required={["name", "email"].includes(field)}
                  type={
                    field === "email"
                      ? "email"
                      : field === "event_date"
                        ? "date"
                        : field === "guest_count"
                          ? "number"
                          : "text"
                  }
                  value={values[field] || ""}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
            {form.turnstile_site_key && (
              <div
                className="cf-turnstile"
                data-sitekey={form.turnstile_site_key}
                data-callback="festioLeadCaptcha"
              />
            )}
            {error && <p className="lead-form-error">{error}</p>}
            <button disabled={!captcha}>Send to Festio</button>
          </form>
        )}
        <footer>
          Your information is used only to respond to this request.
        </footer>
      </section>
    </main>
  );
}
