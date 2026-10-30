# Administration and organization access

ChatFinity separates system administration from organization roles. System administrators manage accounts, password resets, account disabling, organization-creation permission, organization assignments, signup settings and system activity. Organization owners/admins manage their own people, invitations and membership requests. Members can belong to many organizations and receive only conversations they can access.

The shield button opens System administration. Add users there and select one or more organizations, with a member/admin/owner role. A setup email lets the recipient choose their password. Administrators can send a reset link or set a temporary password; temporary passwords must be changed before accessing chat. Disabling an account revokes its sessions. At least one enabled, verified system administrator must remain. Organization assignments preserve at least one owner.

An administrator can explicitly open any organization as an owner. This adds membership and records the action in the system activity log. Private conversations remain governed by conversation membership.

## Signup and Organization IDs

Every organization has a shareable `CF-…` ID, visible in organization management and the system console. The full organization UUID also works. Signup accepts this optional ID. The account must verify its email; then an organization owner/admin or system administrator approves the pending request. Knowing the ID alone never grants membership or message access. An existing verified user can also request another organization from the organization rail.

Accounts signing up with an Organization ID start as participants, without permission to create organizations. System administrators can grant that permission later. Independent accounts use the configured default. Turning public signup off requires a valid email invitation or administrator-created account. Join requests are separate from email invitations: a valid invitation is bound to its recipient's email and can be accepted directly.

## Password changes

Your preferences include **Change password**. Enter the current password and a new password of at least 12 characters. Other sessions are revoked. Administrators cannot view existing passwords; the database stores password hashes.

The initial primary administrator is provisioned using `node apps/server/dist/bootstrap-admin.js` inside the server container. Supply a single JSON object through private stdin containing `email`, `password`, and optional `name`. Never place credentials in command arguments, source files or version control. This recovery utility can update an existing account and revokes its old sessions. It deliberately supports explicitly chosen bootstrap passwords of at least eight characters; normal signup and password changes require twelve.

## Broadcasts

The Send organization broadcast button lets a member select one or more of their organizations. The system console permits system administrators to select any organizations. Every member receives an announcement in that organization's Announcements conversation. Each organization gets a separate message; messages and audiences from other organizations are not disclosed. Authorization for all selected organizations is checked in one transaction before anything is delivered. Broadcasts are limited to ten requests per hour per client address.

## Current limits

This is the first alpha. The console lists the most recent 1,000 accounts and 200 system events. Messages, uploads and meetings follow the limits described in ARCHITECTURE.md. A disabled participant's existing media connection may remain until the meeting is ended; account/session revocation prevents new application access. End active meetings when revoking sensitive meeting access. Admins should not use this alpha for regulated or sensitive production workloads without a dedicated review.
