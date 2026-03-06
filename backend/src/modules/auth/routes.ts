import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool, query } from "../../db/pool";
import { env } from "../../config/env";
import type { AuthPayload } from "../../middleware/auth";

const router = Router();

interface UserRow {
  id: string;
  organization_id: string | null;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: "admin" | "accountant" | "driver";
  is_active: boolean;
}

router.post("/register", async (req, res) => {
  const { organizationName, email, password, phone } = req.body as {
    organizationName?: string;
    email?: string;
    password?: string;
    phone?: string;
  };

  if (!organizationName || !email || !password) {
    return res.status(400).json({ message: "organizationName, email and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters long" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const emailLower = email.toLowerCase();
    const existingUser = await client.query<UserRow>(
      "SELECT id FROM users WHERE email = $1 LIMIT 1",
      [emailLower],
    );
    if (existingUser.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "A user with this email already exists" });
    }

    const orgResult = await client.query<{ id: string }>(
      `
        INSERT INTO organizations (name, email, phone)
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [organizationName, emailLower, phone ?? null],
    );

    const organizationId = orgResult.rows[0].id;

    const passwordHash = await bcrypt.hash(password, 10);

    const userResult = await client.query<UserRow>(
      `
        INSERT INTO users (
          organization_id,
          email,
          password_hash,
          first_name,
          last_name,
          phone,
          role,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'admin', true)
        RETURNING *
      `,
      [organizationId, emailLower, passwordHash, organizationName, "Admin", phone ?? null],
    );

    await client.query("COMMIT");

    const user = userResult.rows[0];

    const payload: AuthPayload = {
      sub: user.id,
      orgId: user.organization_id,
      role: user.role,
    };

    const token = jwt.sign(payload, env.jwtSecret, { expiresIn: "8h" });

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        organizationId: user.organization_id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err: unknown) {
    await client.query("ROLLBACK");
    // eslint-disable-next-line no-console
    console.error("Register error", err);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const { rows } = await query<UserRow>(
      "SELECT * FROM users WHERE email = $1 LIMIT 1",
      [email.toLowerCase()],
    );
    const user = rows[0];

    if (!user || !user.is_active) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const payload: AuthPayload = {
      sub: user.id,
      orgId: user.organization_id,
      role: user.role,
    };

    const token = jwt.sign(payload, env.jwtSecret, { expiresIn: "8h" });

    return res.json({
      token,
      user: {
        id: user.id,
        organizationId: user.organization_id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Login error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export const authRoutes = router;

