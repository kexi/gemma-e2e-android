/**
 * Verbatim-shaped `uiautomator dump` output. Kept as fixtures rather than
 * hand-built UiNode objects so the parser is exercised against the attribute
 * spelling, layout-wrapper nesting, and zero-area nodes a real device emits.
 */

/** A login form: two fields, a disabled submit button, a checkbox. */
export const LOGIN_SCREEN_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="android:id/content" class="android.widget.LinearLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">
      <node index="0" text="Welcome back" resource-id="com.example.app:id/title" class="android.widget.TextView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[60,300][1020,400]" />
      <node index="1" text="" resource-id="com.example.app:id/email" class="android.widget.EditText" package="com.example.app" content-desc="Email address" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="true" scrollable="false" long-clickable="true" password="false" selected="false" bounds="[60,500][1020,640]" />
      <node index="2" text="" resource-id="com.example.app:id/password" class="android.widget.EditText" package="com.example.app" content-desc="Password" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="true" password="true" selected="false" bounds="[60,700][1020,840]" />
      <node index="3" text="Remember me" resource-id="com.example.app:id/remember" class="android.widget.CheckBox" package="com.example.app" content-desc="" checkable="true" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[60,900][500,980]" />
      <node index="4" text="Sign in" resource-id="com.example.app:id/submit" class="android.widget.Button" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="false" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[60,1060][1020,1200]" />
      <node index="5" text="Forgot password?" resource-id="com.example.app:id/forgot" class="android.widget.TextView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[60,1260][1020,1340]" />
      <node index="6" text="" resource-id="com.example.app:id/spacer" class="android.view.View" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][0,0]" />
    </node>
  </node>
</hierarchy>
`;

/** A scrollable list with a toolbar and repeated rows. */
export const LIST_SCREEN_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="com.example.app:id/toolbar" class="android.view.ViewGroup" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,100][1080,260]">
      <node index="0" text="" resource-id="" class="android.widget.ImageButton" package="com.example.app" content-desc="Navigate up" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[20,120][160,240]" />
      <node index="1" text="Inbox" resource-id="com.example.app:id/toolbar_title" class="android.widget.TextView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[180,140][700,220]" />
      <node index="2" text="" resource-id="com.example.app:id/search" class="android.widget.ImageButton" package="com.example.app" content-desc="Search" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[900,120][1040,240]" />
    </node>
    <node index="1" text="" resource-id="com.example.app:id/list" class="androidx.recyclerview.widget.RecyclerView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="true" long-clickable="false" password="false" selected="false" bounds="[0,260][1080,2400]">
      <node index="0" text="" resource-id="" class="android.widget.LinearLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,260][1080,560]">
        <node index="0" text="Weekly report" resource-id="com.example.app:id/row_title" class="android.widget.TextView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[40,300][900,380]" />
        <node index="1" text="Due Friday" resource-id="com.example.app:id/row_subtitle" class="android.widget.TextView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[40,400][900,460]" />
        <node index="2" text="" resource-id="com.example.app:id/row_star" class="android.widget.CheckBox" package="com.example.app" content-desc="Star" checkable="true" checked="true" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[940,340][1040,440]" />
      </node>
      <node index="1" text="" resource-id="" class="android.widget.LinearLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,560][1080,860]">
        <node index="0" text="Invoice #42" resource-id="com.example.app:id/row_title" class="android.widget.TextView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[40,600][900,680]" />
        <node index="1" text="Paid" resource-id="com.example.app:id/row_subtitle" class="android.widget.TextView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[40,700][900,760]" />
        <node index="2" text="" resource-id="com.example.app:id/row_star" class="android.widget.CheckBox" package="com.example.app" content-desc="Star" checkable="true" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[940,640][1040,740]" />
      </node>
    </node>
  </node>
</hierarchy>
`;
