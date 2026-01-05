# Sistema de Control de Obras y Proyectos

Aplicación web integral desarrollada para la gestión, seguimiento y control financiero de obras de construcción. Construida con tecnologías modernas, esta plataforma permite a coordinadores y gerentes supervisar múltiples proyectos, controlar avances diarios, gestionar valorizaciones y monitorear el desempeño financiero en tiempo real.

## 🚀 Tecnologías Principales

*   **Frontend**: React + TypeScript + Vite
*   **Estilos**: Bootstrap 5 (con `react-bootstrap`) + CSS personalizado
*   **Backend / Base de Datos**: Supabase (PostgreSQL)
*   **Autenticación**: Supabase Auth
*   **Gráficos y Visualización**: `react-google-charts` (Gantt, Curvas S), `recharts`
*   **Reportes**: `jspdf` + `jspdf-autotable` para generación de PDFs

## 📋 Módulos del Sistema

### 1. Dashboard Global (`DashboardGlobal.tsx`)
Vista general de alto nivel para la gerencia.
*   **Resumen Financiero**: Visualización de montos totales, ejecutados, valorizados y saldos.
*   **Estado de Obras**: Lista de obras activas con indicadores de progreso.
*   **Curvas S**: Gráficos de avance físico y financiero comparando lo programado vs. ejecutado.

### 2. Gestión de Actividades (`GestionActividades.tsx`)
El núcleo de la planificación del proyecto.
*   **Estructura Jerárquica**: Gestión de Obras Principales, Componentes y Adicionales.
*   **CRUD de Actividades**: Creación y edición de partidas con metrados, precios unitarios y duraciones.
*   **Diagrama de Gantt**: Visualización interactiva del cronograma de obra, ruta crítica y dependencias entre tareas.

### 3. Seguimiento Diario (`SeguimientoDiario.tsx`)
Herramienta operativa para el control de campo día a día.
*   **Registro de Avances**: Ingreso diario de metrados ejecutados por actividad.
*   **Proyecciones Mensuales**: Establecimiento de metas de producción (metrado proyectado) por mes.
*   **Control de Saldos**: Visualización automática de "Metrado Saldo" (Total - Ejecutado).
*   **Alertas Tempranas**: Sistema de alertas (OK, Riesgo, Alerta) basado en el cumplimiento de proyecciones a mitad de mes (día 15).
*   **Valorizaciones**: Cálculo automático de valorizaciones en base a avances y precios unitarios.
*   **Reportes PDF**: Generación de reportes mensuales de seguimiento y valorización con detalle de costos, gastos generales, utilidad e IGV.

### 4. Control Semanal - PPC (`ControlSemanal.tsx`)
Metodología Last Planner System.
*   **Planificación Semanal**: Asignación de tareas y metas semanales.
*   **Cálculo de PPC**: Porcentaje de Plan Completado.
*   **Análisis de Causas**: Registro de causas de no cumplimiento para mejora continua.

### 5. Gestión de Riesgos e Incidencias
*   **Riesgos (`GestionRiesgos.tsx`)**: Matriz de identificación y valoración de riesgos del proyecto.
*   **Incidencias (`GestionIncidencias.tsx`)**: Registro y seguimiento de problemas ocurridos en obra.

### 6. Administración
*   **Gestión de Obras (`GestionObras.tsx`)**: Alta y configuración de nuevos proyectos.
*   **Login (`Login.tsx`)**: Control de acceso seguro basado en roles (Coordinador, Gerencia, etc.).

## 🛠️ Instalación y Configuración

1.  **Requisitos Previos**:
    *   Node.js (v18 o superior)
    *   Cuenta en Supabase

2.  **Instalación de Dependencias**:
    ```bash
    npm install
    ```

3.  **Configuración de Variables de Entorno**:
    Crear un archivo `.env` en la raíz con las credenciales de Supabase:
    ```env
    VITE_SUPABASE_URL=tu_url_supabase
    VITE_SUPABASE_ANON_KEY=tu_clave_anonima
    ```

4.  **Ejecución en Desarrollo**:
    ```bash
    npm run dev
    ```

5.  **Construcción para Producción**:
    ```bash
    npm run build
    ```

## 🗄️ Estructura de Base de Datos (Supabase)

El sistema utiliza tablas relacionales clave en PostgreSQL:
*   `obras`: Proyectos principales y sus componentes.
*   `actividades_obra`: Partidas y tareas con sus metrados y costos.
*   `avance_diario`: Registro histórico de ejecución diaria.
*   `proyecciones_mensuales`: Metas de metrado por mes y actividad.
*   `parametros_obra`: Configuración financiera (Gastos Generales, Utilidad, IGV) por obra.
*   `riesgos`, `incidencias`, `plan_semanal`: Tablas de soporte para otros módulos.

---
**Desarrollado para optimizar el control y la rentabilidad de proyectos de construcción.**
