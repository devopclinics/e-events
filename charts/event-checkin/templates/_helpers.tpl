{{- define "event-checkin.name" -}}
{{ .Values.app.name }}
{{- end }}

{{- define "event-checkin.namespace" -}}
dev-{{ .Values.app.team }}-{{ .Values.app.name }}
{{- end }}

{{- define "event-checkin.labels" -}}
app.kubernetes.io/name: {{ .Values.app.name }}
app.kubernetes.io/team: {{ .Values.app.team }}
app.kubernetes.io/managed-by: platform
{{- end }}

{{- define "event-checkin.backendLabels" -}}
{{ include "event-checkin.labels" . }}
app.kubernetes.io/component: backend
{{- end }}

{{- define "event-checkin.frontendLabels" -}}
{{ include "event-checkin.labels" . }}
app.kubernetes.io/component: frontend
{{- end }}

{{- define "event-checkin.postgresLabels" -}}
{{ include "event-checkin.labels" . }}
app.kubernetes.io/component: postgres
{{- end }}
