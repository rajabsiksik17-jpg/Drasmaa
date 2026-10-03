-- =====================================================================
-- 0013 Built-in message templates (email + WhatsApp, Arabic + English).
-- Administrators can edit them (versions are kept), deactivate them, or
-- add unlimited custom templates. Texts carry no clinical details.
-- =====================================================================

insert into public.message_templates
  (code, channel, category, purpose, name_en, name_ar, subject_en, subject_ar, body_en, body_ar, default_language, is_system, sort_order)
values
-- ----------------------------------------------------------------- EMAIL
('email_appointment_reminder', 'email', 'appointment', 'appointment_reminder',
 'Appointment Reminder', 'تذكير بموعد',
 'Appointment reminder — {{clinic_name}}', 'تذكير بموعدكم — {{clinic_name}}',
$t$Dear {{patient_name}},

This is a reminder that you have an appointment with Dr. {{doctor_name}}.

Date: {{appointment_date}}
Time: {{appointment_time}}
Visit: {{visit_type}}
Clinic: {{clinic_name}}

Please arrive 10 minutes early.
For enquiries: {{clinic_phone}}

Thank you.$t$,
$t$مرحباً {{patient_name}}،

نود تذكيركم بموعدكم لدى د. {{doctor_name}}.

التاريخ: {{appointment_date}}
الوقت: {{appointment_time}}
نوع الزيارة: {{visit_type}}
العيادة: {{clinic_name}}

يرجى الحضور قبل الموعد بعشر دقائق.
للاستفسار: {{clinic_phone}}

مع تمنياتنا لكم بدوام الصحة والعافية.$t$, 'ar', true, 1),

('email_appointment_confirmation', 'email', 'appointment', 'appointment_confirmation',
 'Appointment Confirmation', 'تأكيد موعد',
 'Your appointment is confirmed — {{clinic_name}}', 'تأكيد موعدكم — {{clinic_name}}',
$t$Dear {{patient_name}},

Your appointment has been booked.

Doctor: Dr. {{doctor_name}}
Date: {{appointment_date}}
Time: {{appointment_time}}
Visit: {{visit_type}}

{{clinic_name}} · {{clinic_phone}}
{{clinic_address}}$t$,
$t$مرحباً {{patient_name}}،

تم حجز موعدكم بنجاح.

الطبيب: د. {{doctor_name}}
التاريخ: {{appointment_date}}
الوقت: {{appointment_time}}
نوع الزيارة: {{visit_type}}

{{clinic_name}} · {{clinic_phone}}
{{clinic_address}}$t$, 'ar', true, 2),

('email_appointment_rescheduled', 'email', 'appointment', 'appointment_rescheduled',
 'Appointment Rescheduled', 'إعادة جدولة موعد',
 'Your appointment was rescheduled — {{clinic_name}}', 'تم تغيير موعدكم — {{clinic_name}}',
$t$Dear {{patient_name}},

Your appointment has been moved to:

Date: {{appointment_date}}
Time: {{appointment_time}}
Doctor: Dr. {{doctor_name}}

If this time does not suit you, please call us on {{clinic_phone}}.

{{clinic_name}}$t$,
$t$مرحباً {{patient_name}}،

تم تغيير موعدكم ليصبح:

التاريخ: {{appointment_date}}
الوقت: {{appointment_time}}
الطبيب: د. {{doctor_name}}

إذا كان الموعد غير مناسب يرجى الاتصال على {{clinic_phone}}.

{{clinic_name}}$t$, 'ar', true, 3),

('email_appointment_cancelled', 'email', 'appointment', 'appointment_cancelled',
 'Appointment Cancelled', 'إلغاء موعد',
 'Appointment cancelled — {{clinic_name}}', 'إلغاء الموعد — {{clinic_name}}',
$t$Dear {{patient_name}},

Your appointment on {{appointment_date}} at {{appointment_time}} has been cancelled.

To book a new appointment please call {{clinic_phone}}.

{{clinic_name}}$t$,
$t$مرحباً {{patient_name}}،

تم إلغاء موعدكم بتاريخ {{appointment_date}} الساعة {{appointment_time}}.

لحجز موعد جديد يرجى الاتصال على {{clinic_phone}}.

{{clinic_name}}$t$, 'ar', true, 4),

('email_appointment_followup', 'email', 'medical_followup', 'appointment_followup',
 'Appointment Follow-up', 'متابعة بعد الموعد',
 'Your follow-up — {{clinic_name}}', 'متابعتكم — {{clinic_name}}',
$t$Dear {{patient_name}},

Thank you for visiting {{clinic_name}}.
Your next follow-up is planned for {{followup_date}}.

Please contact us on {{clinic_phone}} to confirm.$t$,
$t$مرحباً {{patient_name}}،

شكراً لزيارتكم {{clinic_name}}.
موعد المتابعة القادم بتاريخ {{followup_date}}.

يرجى التواصل على {{clinic_phone}} للتأكيد.$t$, 'ar', true, 5),

('email_welcome', 'email', 'general', 'welcome',
 'Welcome Message', 'رسالة ترحيب',
 'Welcome to {{clinic_name}}', 'أهلاً بكم في {{clinic_name}}',
$t$Dear {{patient_name}},

Welcome to {{clinic_name}}. We are glad to have you with us.

For appointments and enquiries: {{clinic_phone}}
{{clinic_address}}$t$,
$t$مرحباً {{patient_name}}،

أهلاً وسهلاً بكم في {{clinic_name}}، يسعدنا انضمامكم إلينا.

للمواعيد والاستفسارات: {{clinic_phone}}
{{clinic_address}}$t$, 'ar', true, 6),

('email_registration_confirmation', 'email', 'administrative', 'registration_confirmation',
 'Patient Registration Confirmation', 'تأكيد تسجيل المريضة',
 'Registration confirmed — {{clinic_name}}', 'تأكيد التسجيل — {{clinic_name}}',
$t$Dear {{patient_name}},

Your file has been opened at {{clinic_name}}.
Your patient ID is {{patient_id}} — please keep it for future visits.

{{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،

تم فتح ملفكم في {{clinic_name}}.
رقم الملف: {{patient_id}} — يرجى الاحتفاظ به للزيارات القادمة.

{{clinic_phone}}$t$, 'ar', true, 7),

('email_pregnancy_followup', 'email', 'pregnancy', 'pregnancy_followup_reminder',
 'Pregnancy Follow-up Reminder', 'تذكير متابعة الحمل',
 'Your follow-up visit — {{clinic_name}}', 'موعد المتابعة — {{clinic_name}}',
$t$Dear {{patient_name}},

This is a reminder of your follow-up visit with Dr. {{doctor_name}}
on {{appointment_date}} at {{appointment_time}}.

{{clinic_name}} · {{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،

نذكركم بموعد المتابعة لدى د. {{doctor_name}}
بتاريخ {{appointment_date}} الساعة {{appointment_time}}.

{{clinic_name}} · {{clinic_phone}}$t$, 'ar', true, 8),

('email_fertility_followup', 'email', 'fertility', 'fertility_followup_reminder',
 'Fertility Follow-up Reminder', 'تذكير متابعة الخصوبة',
 'Your follow-up visit — {{clinic_name}}', 'موعد المتابعة — {{clinic_name}}',
$t$Dear {{patient_name}},

This is a reminder of your follow-up visit with Dr. {{doctor_name}}
on {{appointment_date}} at {{appointment_time}}.

{{clinic_name}} · {{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،

نذكركم بموعد المتابعة لدى د. {{doctor_name}}
بتاريخ {{appointment_date}} الساعة {{appointment_time}}.

{{clinic_name}} · {{clinic_phone}}$t$, 'ar', true, 9),

('email_ivf_appointment', 'email', 'ivf', 'ivf_appointment_reminder',
 'IVF Appointment Reminder', 'تذكير موعد أطفال الأنابيب',
 'Your appointment — {{clinic_name}}', 'موعدكم — {{clinic_name}}',
$t$Dear {{patient_name}},

Your appointment with Dr. {{doctor_name}} is on {{appointment_date}} at {{appointment_time}}.
Please follow the instructions given to you by the clinic team.

{{clinic_name}} · {{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،

موعدكم لدى د. {{doctor_name}} بتاريخ {{appointment_date}} الساعة {{appointment_time}}.
يرجى الالتزام بالتعليمات التي زودكم بها فريق العيادة.

{{clinic_name}} · {{clinic_phone}}$t$, 'ar', true, 10),

('email_investigation_result', 'email', 'medical_followup', 'investigation_result',
 'Investigation Result Notification', 'إشعار نتيجة فحص',
 'Your results are ready — {{clinic_name}}', 'النتائج جاهزة — {{clinic_name}}',
$t$Dear {{patient_name}},

Your investigation results are now available at the clinic.
Please contact us on {{clinic_phone}} or discuss them at your next visit.

{{clinic_name}}$t$,
$t$مرحباً {{patient_name}}،

نتائج فحوصاتكم أصبحت متوفرة في العيادة.
يرجى التواصل معنا على {{clinic_phone}} أو مناقشتها في زيارتكم القادمة.

{{clinic_name}}$t$, 'ar', true, 11),

('email_general_message', 'email', 'general', 'general_message',
 'General Clinic Message', 'رسالة عامة من العيادة',
 'Message from {{clinic_name}}', 'رسالة من {{clinic_name}}',
$t$Dear {{patient_name}},



{{clinic_name}} · {{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،



{{clinic_name}} · {{clinic_phone}}$t$, 'ar', true, 12),

('email_birthday', 'email', 'congratulations', 'birthday',
 'Birthday / Congratulations', 'تهنئة عيد ميلاد',
 'Happy birthday from {{clinic_name}}', 'كل عام وأنتم بخير — {{clinic_name}}',
$t$Dear {{patient_name}},

Wishing you a very happy birthday and a year full of health.

With best wishes,
{{clinic_name}}$t$,
$t$عزيزتنا {{patient_name}}،

كل عام وأنتِ بخير، نتمنى لكِ عاماً مليئاً بالصحة والسعادة.

مع أطيب التمنيات،
{{clinic_name}}$t$, 'ar', true, 13),

('email_thank_you', 'email', 'general', 'thank_you',
 'Thank You Message', 'رسالة شكر',
 'Thank you — {{clinic_name}}', 'شكراً لكم — {{clinic_name}}',
$t$Dear {{patient_name}},

Thank you for choosing {{clinic_name}}. We wish you good health.

{{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،

شكراً لاختياركم {{clinic_name}}، مع تمنياتنا لكم بدوام الصحة والعافية.

{{clinic_phone}}$t$, 'ar', true, 14),

('email_custom', 'email', 'custom', 'custom',
 'Custom Message', 'رسالة مخصصة',
 '{{clinic_name}}', '{{clinic_name}}',
$t$Dear {{patient_name}},



{{clinic_name}}$t$,
$t$مرحباً {{patient_name}}،



{{clinic_name}}$t$, 'ar', true, 15),

('email_document_share', 'email', 'documents', 'document_share',
 'Medical Document', 'مستند طبي',
 '{{document_type}} — {{patient_name}} — {{document_date}}', '{{document_type}} — {{patient_name}} — {{document_date}}',
$t$Dear {{patient_name}},

Please find attached your document: {{document_type}} ({{document_date}}).

Regards,
{{clinic_name}}
{{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،

نرفق لكم الملف الخاص بكم: {{document_type}} بتاريخ {{document_date}}.

مع تمنياتنا لكم بدوام الصحة والعافية،
{{clinic_name}}
{{clinic_phone}}$t$, 'ar', true, 16),

('email_otp_code', 'email', 'security', 'otp_code',
 'Login Verification Code', 'رمز التحقق لتسجيل الدخول',
 'Your verification code — {{clinic_name}}', 'رمز التحقق — {{clinic_name}}',
$t$Hello {{user_name}},

Your verification code is: {{otp_code}}

It expires in {{otp_minutes}} minutes and can be used once.
If you did not try to sign in, change your password and contact the administrator.$t$,
$t$مرحباً {{user_name}}،

رمز التحقق الخاص بك هو: {{otp_code}}

صالح لمدة {{otp_minutes}} دقائق ولمرة واحدة فقط.
إذا لم تحاول تسجيل الدخول، يرجى تغيير كلمة المرور والتواصل مع مدير النظام.$t$, 'en', true, 30),

('email_new_login_alert', 'email', 'security', 'new_login_alert',
 'New Login Alert', 'تنبيه تسجيل دخول جديد',
 'New login to your account — {{clinic_name}}', 'تسجيل دخول جديد إلى حسابك — {{clinic_name}}',
$t$New login detected

Account: {{user_email}}
Device: {{device}}
Time: {{login_time}}

If this was not you, review your active sessions immediately and change your password.$t$,
$t$تم رصد تسجيل دخول جديد

الحساب: {{user_email}}
الجهاز: {{device}}
الوقت: {{login_time}}

إذا لم تكن أنت، راجع الجلسات النشطة فوراً وغيّر كلمة المرور.$t$, 'en', true, 31),

('email_security_alert', 'email', 'security', 'security_alert',
 'Security Alert', 'تنبيه أمني',
 'Security alert — {{clinic_name}}', 'تنبيه أمني — {{clinic_name}}',
$t${{notification_title}}

{{notification_message}}

Time: {{login_time}}
Review: {{link}}$t$,
$t${{notification_title}}

{{notification_message}}

الوقت: {{login_time}}
للمراجعة: {{link}}$t$, 'en', true, 32),

('email_notification', 'email', 'administrative', 'notification',
 'Notification Email', 'بريد الإشعارات',
 '{{notification_title}} — {{clinic_name}}', '{{notification_title}} — {{clinic_name}}',
$t${{notification_title}}

{{notification_message}}

Open: {{link}}$t$,
$t${{notification_title}}

{{notification_message}}

فتح: {{link}}$t$, 'en', true, 33),

('email_test', 'email', 'administrative', 'test_email',
 'Test Email', 'بريد تجريبي',
 'Test email — {{clinic_name}}', 'بريد تجريبي — {{clinic_name}}',
$t$This is a test email from {{clinic_name}}.
Your email configuration works correctly.$t$,
$t$هذه رسالة تجريبية من {{clinic_name}}.
إعدادات البريد الإلكتروني تعمل بشكل صحيح.$t$, 'en', true, 34),

-- -------------------------------------------------------------- WHATSAPP
('wa_appointment_reminder', 'whatsapp', 'appointment', 'appointment_reminder',
 'Appointment Reminder', 'تذكير بموعد', null, null,
$t$Hello {{patient_name}},

This is a reminder of your appointment:

Clinic: {{clinic_name}}
Doctor: Dr. {{doctor_name}}
Date: {{appointment_date}}
Time: {{appointment_time}}
Visit: {{visit_type}}

Wishing you good health.
Enquiries: {{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،

نود تذكيركم بأن لديكم موعداً في:

العيادة:
{{clinic_name}}

الطبيب:
د. {{doctor_name}}

التاريخ:
{{appointment_date}}

الوقت:
{{appointment_time}}

نوع الزيارة:
{{visit_type}}

نتمنى لكم دوام الصحة والعافية.

للاستفسار:
{{clinic_phone}}$t$, 'ar', true, 1),

('wa_appointment_confirmation', 'whatsapp', 'appointment', 'appointment_confirmation',
 'Appointment Confirmation', 'تأكيد موعد', null, null,
$t$Hello {{patient_name}},
Your appointment with Dr. {{doctor_name}} is confirmed for {{appointment_date}} at {{appointment_time}}.
{{clinic_name}} · {{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،
تم تأكيد موعدكم لدى د. {{doctor_name}} بتاريخ {{appointment_date}} الساعة {{appointment_time}}.
{{clinic_name}} · {{clinic_phone}}$t$, 'ar', true, 2),

('wa_appointment_rescheduled', 'whatsapp', 'appointment', 'appointment_rescheduled',
 'Appointment Rescheduled', 'إعادة جدولة موعد', null, null,
$t$Hello {{patient_name}},
Your appointment has been moved to {{appointment_date}} at {{appointment_time}} with Dr. {{doctor_name}}.
{{clinic_name}} · {{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،
تم تغيير موعدكم إلى {{appointment_date}} الساعة {{appointment_time}} لدى د. {{doctor_name}}.
{{clinic_name}} · {{clinic_phone}}$t$, 'ar', true, 3),

('wa_appointment_cancelled', 'whatsapp', 'appointment', 'appointment_cancelled',
 'Appointment Cancelled', 'إلغاء موعد', null, null,
$t$Hello {{patient_name}},
Your appointment on {{appointment_date}} at {{appointment_time}} has been cancelled.
To book again: {{clinic_phone}}
{{clinic_name}}$t$,
$t$مرحباً {{patient_name}}،
تم إلغاء موعدكم بتاريخ {{appointment_date}} الساعة {{appointment_time}}.
لحجز موعد جديد: {{clinic_phone}}
{{clinic_name}}$t$, 'ar', true, 4),

('wa_followup_reminder', 'whatsapp', 'medical_followup', 'followup_reminder',
 'Follow-up Reminder', 'تذكير بالمتابعة', null, null,
$t$Hello {{patient_name}},
A reminder of your follow-up with Dr. {{doctor_name}} on {{appointment_date}} at {{appointment_time}}.
{{clinic_name}} · {{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،
نذكركم بموعد المتابعة لدى د. {{doctor_name}} بتاريخ {{appointment_date}} الساعة {{appointment_time}}.
{{clinic_name}} · {{clinic_phone}}$t$, 'ar', true, 5),

('wa_birthday', 'whatsapp', 'congratulations', 'birthday',
 'Birthday Congratulations', 'تهنئة عيد ميلاد', null, null,
$t$Dear {{patient_name}}, happy birthday! Wishing you a year full of health and happiness.
{{clinic_name}}$t$,
$t$عزيزتنا {{patient_name}}، كل عام وأنتِ بخير! نتمنى لكِ عاماً مليئاً بالصحة والسعادة.
{{clinic_name}}$t$, 'ar', true, 6),

('wa_pregnancy_congratulations', 'whatsapp', 'pregnancy', 'pregnancy_congratulations',
 'Pregnancy Congratulations', 'تهنئة بالحمل', null, null,
$t$Dear {{patient_name}}, warm congratulations from all of us at {{clinic_name}}. We wish you a healthy pregnancy.$t$,
$t$عزيزتنا {{patient_name}}، ألف مبروك من جميع فريق {{clinic_name}}، نتمنى لكِ حملاً سليماً وصحة دائمة.$t$, 'ar', true, 7),

('wa_general_message', 'whatsapp', 'general', 'general_message',
 'General Patient Message', 'رسالة عامة للمريضة', null, null,
$t$Hello {{patient_name}},

{{clinic_name}} · {{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،

{{clinic_name}} · {{clinic_phone}}$t$, 'ar', true, 8),

('wa_fertility_followup', 'whatsapp', 'fertility', 'fertility_followup',
 'Fertility Follow-up', 'متابعة الخصوبة', null, null,
$t$Hello {{patient_name}},
A reminder of your visit with Dr. {{doctor_name}} on {{appointment_date}} at {{appointment_time}}.
{{clinic_name}} · {{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،
نذكركم بموعدكم لدى د. {{doctor_name}} بتاريخ {{appointment_date}} الساعة {{appointment_time}}.
{{clinic_name}} · {{clinic_phone}}$t$, 'ar', true, 9),

('wa_ivf_appointment', 'whatsapp', 'ivf', 'ivf_appointment',
 'IVF Appointment', 'موعد أطفال الأنابيب', null, null,
$t$Hello {{patient_name}},
Your appointment with Dr. {{doctor_name}} is on {{appointment_date}} at {{appointment_time}}. Please follow the instructions given by the clinic team.
{{clinic_name}} · {{clinic_phone}}$t$,
$t$مرحباً {{patient_name}}،
موعدكم لدى د. {{doctor_name}} بتاريخ {{appointment_date}} الساعة {{appointment_time}}، يرجى الالتزام بتعليمات فريق العيادة.
{{clinic_name}} · {{clinic_phone}}$t$, 'ar', true, 10),

('wa_custom', 'whatsapp', 'custom', 'custom',
 'Custom Message', 'رسالة مخصصة', null, null,
$t$Hello {{patient_name}},

{{clinic_name}}$t$,
$t$مرحباً {{patient_name}}،

{{clinic_name}}$t$, 'ar', true, 11),

('wa_document_share', 'whatsapp', 'documents', 'document_share',
 'Medical Document', 'مستند طبي', null, null,
$t$Hello {{patient_name}},

Please find attached your document from the clinic.

Document: {{document_type}}
Date: {{document_date}}

Wishing you good health.
{{clinic_name}}$t$,
$t$مرحباً {{patient_name}}،

نرفق لكم الملف الخاص بزيارتكم لدى العيادة.

نوع الملف:
{{document_type}}

التاريخ:
{{document_date}}

مع تمنياتنا لكم بدوام الصحة والعافية.

{{clinic_name}}$t$, 'ar', true, 12)
on conflict (code) do nothing;
