import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { getSession, commitSession } from "~/utils/superadmin-session.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const session = await getSession(request.headers.get("Cookie"));
  
  if (session.get("authenticated")) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/superadmin/dashboard",
      },
    });
  }
  
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const password = formData.get("password");
  
  if (password !== "Adedayo14") {
    return json({ error: "Invalid password" }, { status: 401 });
  }
  
  const session = await getSession(request.headers.get("Cookie"));
  session.set("authenticated", true);
  
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": await commitSession(session),
      Location: "/superadmin/dashboard",
    },
  });
};

export default function SuperAdminLogin() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [password, setPassword] = useState("");
  const isSubmitting = navigation.state === "submitting";

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    }}>
      <div style={{
        background: "white",
        padding: "48px",
        borderRadius: "16px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        width: "100%",
        maxWidth: "400px"
      }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <h1 style={{ fontSize: "28px", fontWeight: "700", marginBottom: "8px", color: "#1a1a1a" }}>
            Cart Uplift
          </h1>
          <p style={{ color: "#666", fontSize: "14px" }}>Super Admin Access</p>
        </div>
        
        <Form method="post">
          <div style={{ marginBottom: "24px" }}>
            <label 
              htmlFor="password" 
              style={{ 
                display: "block", 
                marginBottom: "8px", 
                fontSize: "14px", 
                fontWeight: "600",
                color: "#333"
              }}
            >
              Password
            </label>
            <input
              type="password"
              id="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              style={{
                width: "100%",
                padding: "12px 16px",
                fontSize: "16px",
                border: "2px solid #e0e0e0",
                borderRadius: "8px",
                outline: "none",
                transition: "border-color 0.2s",
                boxSizing: "border-box"
              }}
              onFocus={(e) => e.target.style.borderColor = "#667eea"}
              onBlur={(e) => e.target.style.borderColor = "#e0e0e0"}
            />
          </div>
          
          {actionData?.error && (
            <div style={{
              background: "#fee",
              color: "#c33",
              padding: "12px",
              borderRadius: "8px",
              fontSize: "14px",
              marginBottom: "24px",
              border: "1px solid #fcc"
            }}>
              {actionData.error}
            </div>
          )}
          
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              width: "100%",
              padding: "14px",
              fontSize: "16px",
              fontWeight: "600",
              color: "white",
              background: isSubmitting ? "#999" : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              border: "none",
              borderRadius: "8px",
              cursor: isSubmitting ? "not-allowed" : "pointer",
              transition: "transform 0.2s, box-shadow 0.2s",
              boxShadow: "0 4px 14px rgba(102, 126, 234, 0.4)"
            }}
            onMouseEnter={(e) => {
              if (!isSubmitting) {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 6px 20px rgba(102, 126, 234, 0.6)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 14px rgba(102, 126, 234, 0.4)";
            }}
          >
            {isSubmitting ? "Authenticating..." : "Access Dashboard"}
          </button>
        </Form>
      </div>
    </div>
  );
}
