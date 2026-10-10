---
name: check-bill
description: Find a bill (boleto or Pix) that arrived on WhatsApp, read its payment codes and check them before anyone pays. Use when the owner asks about a bill, a boleto, a Pix code or a payment due that came through WhatsApp.
metadata:
  connectors: whatsapp
---

# Check a bill from WhatsApp

1. Find the message. Use `find_chat` for the sender's name or number, or `list_chats` for recent chats, then
   `read_chat` and pick the newest message whose `media` is `pdf` or `image`.
2. Read it with `read_bill`. If the PDF is locked, look for the password in the same chat (it is usually a CPF
   prefix or a date) and call `read_bill` again with it. Never guess more than the chat suggests.
3. Report to the owner, in this order:
   - who sent it, and whether `fromSavedContact` is `true`, `false` or unknown (`null`);
   - each code: kind, amount, due date and `status`;
   - anything odd: an `unconfirmed` code, an unknown sender, an amount or payee that differs from earlier bills
     in the same chat, or several different codes.
4. Stop there. Never pay, schedule or forward a bill, and never say a bill is genuine: a confirmed code only means
   it was read correctly.
